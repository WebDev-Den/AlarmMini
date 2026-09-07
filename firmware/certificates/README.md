# TLS trust roots

Mozilla CA bundle distributed by curl, fetched 2026-09-07 from https://curl.se/ca/cacert.pem.

`common-roots.pem` contains 22 common public roots from the same pinned source. ESP32 tries these full certificates first so mbedTLS can anchor cross-signed chains correctly; its older compact-bundle verifier fails on some such chains. Other issuers use the complete compact bundle. Both paths verify certificates and hostnames; no untrusted or removed roots are added. The generator limits the full PEM set to bound ESP32 RAM usage.

SHA-256 of cacert.pem: `f66dff1bdf8f96060b8177976f8b7d9254bc89bc4db933d769f7384d28480bc9`. Contains 121 roots. The PEM includes source/license information. `roots.bundle` uses the ESP-IDF subject/key format, sorted by subject DER. `work_data/certs.ar` is an ar archive of the same certificates in DER for ESP8266 BearSSL CertStore. Generated with scripts/update_tls_roots.py; updates must be reviewed and tested on both targets.
