#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

/**
 * Rewrite the changelog's pending section so it lists every unreleased commit,
 * in the order they landed, using the exact commit subjects.
 *
 * This is the local counterpart to the `check_changelog` job in the shared
 * `nodejs-build-and-test` workflow: run this before pushing, and CI will agree.
 * The check deliberately stays in CI rather than this script writing from CI -
 * a pull request from a fork cannot be written back to, which is precisely the
 * case where changelog entries have gone missing before.
 *
 *   npm run changelog:sync
 *
 * Existing " (@user)" credits are preserved. Nothing else in the file is
 * touched, and running it twice changes nothing the second time. A subject that
 * appears more than once gets a single bullet.
 */

const sh = cmd => execSync(cmd, { encoding: 'utf8' }).trim()

// Commits that legitimately have no bullet of their own. Kept identical to the
// CI check - if these two ever disagree, CI is the authority.
const IGNORED_SUBJECTS = [
  /^v\d+\.\d+\.\d+/, // version commits made by `npm version`
  /^chore\(release\)/, // version commits made by the release workflow
  /^docs\(changelog\)/, // corrections to the changelog itself
  /^Merge /, // merge commits
]

const CHANGELOG = process.argv[2] ?? 'CHANGELOG.md'

let tag
try {
  tag = sh('git describe --tags --abbrev=0')
} catch {
  console.error('No tags found - nothing to sync against.')
  process.exit(1)
}

const seen = new Set()
const commits = sh(`git log --reverse --format=%s ${tag}..HEAD`)
  .split('\n')
  .filter(Boolean)
  .filter(subject => !IGNORED_SUBJECTS.some(re => re.test(subject)))
  // A fix cherry-picked onto a release branch as well as the main one shows up
  // once per branch after they are merged. It is still a single change and wants
  // a single bullet, so keep only the first sighting - the point at which it
  // entered this release. The CI check collapses them the same way.
  .filter((subject) => {
    if (seen.has(subject)) {
      return false
    }
    seen.add(subject)
    return true
  })

if (commits.length === 0) {
  console.log(`No unreleased commits since ${tag}. Nothing to do.`)
  process.exit(0)
}

const original = readFileSync(CHANGELOG, 'utf8')
const lines = original.split('\n')

const headingIndex = lines.findIndex(l => l.startsWith('## '))
if (headingIndex === -1) {
  console.error(`${CHANGELOG} has no "## " section to work with.`)
  process.exit(1)
}

// Is the top section already released? If its version matches the most recent
// tag, these commits belong in a new section above it rather than appended to
// a version that has already shipped.
const topVersion = lines[headingIndex].match(/\d+\.\d+\.\d+/)?.[0]
const tagVersion = tag.replace(/^v/, '')
const topIsReleased = topVersion === tagVersion

function nextPatch(version) {
  const [major, minor, patch] = version.split('.').map(Number)
  return `${major}.${minor}.${patch + 1}`
}

// Reuse the file's own conventions rather than imposing new ones.
const usesVPrefix = lines[headingIndex].startsWith('## v')
const subheading = lines.slice(headingIndex).find(l => l.startsWith('### ')) ?? '### Changed'

let sectionStart, sectionEnd, existingBullets
if (topIsReleased) {
  sectionStart = sectionEnd = headingIndex
  existingBullets = []
} else {
  const rest = lines.slice(headingIndex + 1)
  const nextHeading = rest.findIndex(l => l.startsWith('## '))
  sectionStart = headingIndex
  sectionEnd = nextHeading === -1
    ? lines.length
    : headingIndex + 1 + nextHeading
  existingBullets = lines.slice(sectionStart, sectionEnd)
    .filter(l => l.startsWith('- '))
    .map(l => l.slice(2))
}

// Keep any bullet already carrying a credit for the same subject.
const bullets = commits.map((subject) => {
  const existing = existingBullets.find(b => b === subject || b.startsWith(`${subject} (@`))
  return existing ?? subject
})

const heading = topIsReleased
  ? `## ${usesVPrefix ? 'v' : ''}${nextPatch(tagVersion)} (Pending Release)`
  : lines[headingIndex]

const section = [
  heading,
  '',
  subheading,
  '',
  ...bullets.map(b => `- ${b}`),
  '',
]
const updated = [
  ...lines.slice(0, sectionStart),
  ...section,
  ...lines.slice(sectionEnd),
].join('\n')

if (updated === original) {
  console.log(`${CHANGELOG} already matches all ${commits.length} unreleased commits since ${tag}.`)
  process.exit(0)
}

writeFileSync(CHANGELOG, updated)

const added = bullets.filter(b => !existingBullets.includes(b))
const removed = existingBullets.filter(b => !bullets.includes(b))
console.log(`Synced ${CHANGELOG} against ${commits.length} unreleased commits since ${tag}:`)
for (const b of added) {
  console.log(`  + ${b}`)
}
for (const b of removed) {
  console.log(`  - ${b}`)
}
if (!added.length && !removed.length) {
  console.log('  reordered to match the commits')
}
