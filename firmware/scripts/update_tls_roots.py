"""Regenerate both embedded trust stores from the reviewed, pinned Mozilla PEM.

Requires cryptography. This script does not download or update trust implicitly.
"""
from pathlib import Path
import struct
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

root = Path(__file__).resolve().parents[1]
certs = x509.load_pem_x509_certificates((root / 'certificates/cacert.pem').read_bytes())
entries = sorted((cert.subject.public_bytes(), cert.public_key().public_bytes(
    Encoding.DER, PublicFormat.SubjectPublicKeyInfo)) for cert in certs)
bundle = struct.pack('>H', len(entries))
for subject, key in entries:
    bundle += struct.pack('>HH', len(subject), len(key)) + subject + key
(root / 'certificates/roots.bundle').write_bytes(bundle)
# Arduino ESP32 2.x's compact verifier cannot anchor some cross-signed chains
# at an intermediate trust root. Full certificates let mbedTLS build that path.
# Keep common public roots in PEM as well, bounded to avoid parsing all 121 roots
# into RAM. The compact store remains available for other issuers.
prefixes = ('GTS Root ', 'ISRG Root ', 'Amazon Root ', 'DigiCert ',
            'SSL.com TLS ', 'USERTrust ', 'Sectigo Public ')
common = [cert for cert in certs if any(
    attr.value.startswith(prefixes) for attr in cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME))]
(root / 'certificates/common-roots.pem').write_bytes(b''.join(cert.public_bytes(Encoding.PEM) for cert in common))
archive = bytearray(b'!<arch>\n')
for i, cert in enumerate(certs):
    data = cert.public_bytes(Encoding.DER)
    name = f'ca_{i:03d}.der/'
    archive.extend(f'{name:<16}{0:<12}{0:<6}{0:<6}{100644:<8}{len(data):<10}`\n'.encode('ascii'))
    archive.extend(data)
    if len(data) % 2:
        archive.extend(b'\n')
(root / 'work_data/certs.ar').write_bytes(archive)
print(f'Generated trust stores: {len(certs)} roots')
