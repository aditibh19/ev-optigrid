# Evidence from the executed training run

Open [Model evaluation](../MODEL_EVALUATION.md) for the benchmark and interpretation. This folder contains the files to show alongside the app during a project defence.

| File | What to show |
| --- | --- |
| [training-console.log](training-console.log) | Native TensorFlow.js startup, 10 LSTM epochs, 9 hybrid epochs, measured validation and test output |
| [epoch-losses.csv](epoch-losses.csv) | Epoch, normalized train/validation loss and selected checkpoint flag |
| [holdout-example.csv](holdout-example.csv) | 24 actual ACN values and each model's predictions for the same unseen forecast window |
| [native-metrics.json](native-metrics.json) | Native benchmark with validation/test scores, per-site and per-horizon breakdown |
| [wasm-evaluation.log](wasm-evaluation.log) | Independent evaluation of the packaged weights and test set using the app's WASM backend |
| [wasm-metrics.json](wasm-metrics.json) | Full WASM scores. Test MAE/RMSE agree with the native run to within 0.000001 kWh |
| [SHA256SUMS.txt](SHA256SUMS.txt) | Checksums for both source CSVs, quality output, weights, topology, and training configuration |

The model definitions and training/evaluation source are in `ml/`. The trained artifacts are `ml/artifacts/lstm.bin`, `ml/artifacts/lstm.json`, `ml/artifacts/hybrid.bin`, and `ml/artifacts/hybrid.json`. Training hyperparameters and exact epoch records are in `ml/artifacts/training.json`. The seasonal baseline uses the training-only fallback statistics in the same file.

## Reproduce on a different computer

From the project root, install dependencies with `npm ci`, then run `npm run validate` and `npm run evaluate`. Evaluation uses the supplied checkpoints and does not retrain. To protect the original results, unzip a second copy before rerunning any command that rewrites artifacts. On Linux, `sha256sum -c docs/training-evidence/SHA256SUMS.txt` checks the packaged files before regenerating them. In PowerShell, `Get-FileHash ml/artifacts/hybrid.bin -Algorithm SHA256` prints one of the listed hashes.

To show model training itself, run the native command in the setup guide under Node 22. Loss and test results can vary slightly on retraining because minibatch shuffling is not seeded. The checkpoint files, logs and outputs here are from the same packaged run.
