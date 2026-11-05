# Audits

Each report covers only the listed commit and scope. Later releases and changes on `main`
require their own review. Report PDFs are stored alongside this index and are named
`YYYY-MM-<target>.pdf`.

| Date | Target | Commit | Auditor | Scope | Links |
| --- | --- | --- | --- | --- | --- |
| Nov 2026 | v0.4.0 | [`f270f73`](https://github.com/OpenZeppelin/compact-contracts/tree/f270f73a14394f34e36f591c5d7886289d2aeffd), [`5cc68d3`](https://github.com/OpenZeppelin/compact-contracts/tree/5cc68d3f391d2c8ec72ce5f908dd8f67817e4762) | OpenZeppelin | Multisig, ECDSA, EIP-712, EVM ABI (`f270f73`); `ZOwnableNativeShieldedToken` preset (both) | [Report](./2026-11-v0.4.0.pdf) |
| May 2026 | v0.1.0 | [`d8ee045`](https://github.com/OpenZeppelin/compact-contracts/tree/d8ee045f30153f49b11b82a2f891066ee402a25f) | OpenZeppelin | Full library (access, security, token, utils) | [Report](./2026-05-v0.1.0.pdf) |

Fixes for the findings in the May 2026 audit were merged at [`9b6b21a`](https://github.com/OpenZeppelin/compact-contracts/tree/9b6b21abb057e954cecd137275727f975359bb59).

Fixes for the findings in the November 2026 audit were merged at [`0072715`](https://github.com/OpenZeppelin/compact-contracts/tree/0072715b3d9a0526255c6829447a46c221ac444b) on `release/v0.4.0`. The same audit reviewed the fixes for the August 2026 (`v0.3.0-alpha.1`) High and Medium findings, and L-01, at [`915a487`](https://github.com/OpenZeppelin/compact-contracts/tree/915a4870e6b3ae110b29633fd914b5e4609c5a6f).
