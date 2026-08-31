import { createPrivateKey, X509Certificate } from 'node:crypto'
import fs from 'node:fs'

import { describe, expect, it } from 'vitest'

import { pfxToCertAndKey } from './functions.js'

/**
 * The account's identity file arrives as PKCS#12, usually protected with the
 * older RC2/3DES ciphers. Parsing used to shell out to the system's openssl
 * binary, which refuses those ciphers on openssl 3 unless its legacy provider
 * is installed - so the AWS connection worked on some systems and failed on
 * others, and failed everywhere openssl was not installed at all.
 *
 * The fixture is a self-signed identity exported with exactly those legacy
 * ciphers, and the expected files are what the previous implementation
 * extracted from it - the swap was proven byte-identical before the old code
 * was removed.
 */
describe('reading the identity file', () => {
  const out = () => pfxToCertAndKey('test/fixtures/identity.pfx', 'testpassword')

  it('extracts the same certificate and key as before, byte for byte', async () => {
    const { cert, key } = await out()

    expect(cert).toBe(fs.readFileSync('test/fixtures/identity-cert.pem', 'utf8').trim())
    expect(key).toBe(fs.readFileSync('test/fixtures/identity-key.pem', 'utf8').trim())
  })

  it('produces a pair node itself can load, and they belong together', async () => {
    const { cert, key } = await out()

    const x509 = new X509Certificate(cert)
    const priv = createPrivateKey(key)
    expect(x509.checkPrivateKey(priv)).toBe(true)
  })

  it('refuses a wrong password rather than returning something broken', async () => {
    await expect(pfxToCertAndKey('test/fixtures/identity.pfx', 'wrong')).rejects.toThrow()
  })
})
