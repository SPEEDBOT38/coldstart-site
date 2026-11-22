# Compositor deployment evaluation (rembg + Pillow, `workers/composite`)

## Measured here (2 vCPU sandbox, CPU only, 1080×1350 output)
| Metric | Value |
|---|---|
| Python dependencies on disk (rembg 2.0.87 + onnxruntime + Pillow + numpy + transitive) | **507 MB** (llvmlite 172, scipy 81, onnxruntime 73, scikit-image 30, numba 17; pulled in by rembg's `pymatting`) |
| Import + model load | 0.96 s |
| First request | 0.78 s; warm requests 0.58–0.64 s |
| Peak RSS | 762 MB |
| Model weights | `u2netp.onnx`, 4,574,861 bytes, sha256 `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` (pinned in `service.py`, startup refuses a mismatch) |
| Weights source | https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx |
| Weights licence | U-2-Net, Apache-2.0 (LICENSE read from raw.githubusercontent.com today). The rembg release asset is a redistribution; a legal review should confirm no extra terms. |

## Vercel Python Functions (read from Vercel docs/changelog via search; **not deployed, no Vercel access here**)
- Standard Python bundle limit 500 MB uncompressed; Large Functions (public beta, Fluid compute) up to 5 GB. Memory max 2 GB Hobby / 4 GB Pro.
- The measured 507 MB **exceeds 500 MB** before adding code and the model, so deployment needs either the Large Functions beta or dependency pruning. `rembg` cannot be imported without `pymatting` (numba/llvmlite, ~190 MB), so pruning means not importing `rembg` at all (calling onnxruntime with the u2netp preprocessing directly). That is a deliberate deviation from "reuse rembg" and is **not done**.
- Memory 762 MB and ~1 s cold-start/0.6 s warm fit Vercel's limits on paper. Not measured on Vercel. Cost under Fluid compute pricing was not verified.
- **Verdict:** feasible only via the Large Functions beta (unverified for this account). A single container (Cloud Run / Fly) running `service.py` unchanged is the simplest alternative if the beta is unavailable. No new host was introduced.

## Segmentation quality vs protected-pixel preservation (measured separately)
`workers/composite/eval/stress_eval.py` → `docs/evidence/segmentation-eval.json`. **Synthetic stress fixtures with exact ground truth, not genuine photographs** (the sandbox cannot download photos and the connected folders contain none).
| Case | IoU | Boundary F1 (2 px) | Preservation check |
|---|---|---|---|
| glossy bottle | 0.996 | 1.00 | pass |
| transparent bottle | 0.983 | 0.889 | pass |
| thin edges (wire stand) | **0.179** | 0.696 | needs_review |
| small-label jar | 0.993 | 0.999 | pass |
| reflective can | 0.992 | 1.00 | pass |
Reading: preservation can "pass" while segmentation is wrong, because it only proves the matte's kept pixels were not altered. The synthetic backgrounds are easy, so the high IoUs say little about real photos. The thin-edge case shows the pipeline degrades to `needs_review` instead of passing. **Genuine photos of reflective, transparent, small-print and thin-edged products still must be tested.**
