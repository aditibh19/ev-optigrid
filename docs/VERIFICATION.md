# Verification and integration status

| Area | Result |
| --- | --- |
| Upload validation | Executed with both supplied CSVs. Confirmed 104,995 ACN rows, seven sites and 478 EV records. The data-quality JSON records missing observations and EV fields. |
| Model training | Executed the LSTM and CNN–BiLSTM–Attention under TensorFlow.js using the native Linux backend. Saved selected checkpoints. |
| Model evaluation | Executed both baselines and the hybrid on the common-calendar validation and test splits. Reevaluated the same weights with WASM. |
| Automated tests | Seven Node tests passed. These included a real MongoDB 7.0.14 integration test covering forecast inference, scoped records, live Socket.IO events and persistence after an application restart. |
| Browser workflow | One Playwright Chromium test passed. It exercised a hybrid forecast, the optimizer, live charging to target SOC, simulated driving and reopening a saved plan. |
| Docker | Dockerfile and Compose file are included. Compose YAML parsed and the expected health dependency, loopback port mapping and volume were checked. The environment had no Docker engine, so the image build and container startup remain unverified. |
| OCPP demo | BootNotification, Heartbeat and StatusNotification were exchanged over loopback WebSocket using a virtual charge point and gateway. The dashboard additionally exchanges MeterValues for each slot through an integrated gateway. The MongoDB test verified two receipts and the final cumulative energy. The browser test verified site comparison and receipt visibility. |
| Physical charging | Battery SOC, driving, tariffs and site headroom are simulations or assumptions. No physical charger, vehicle, utility API, live ACN ingest, or billing was tested. |

The executed commands and results are in [verification-console.txt](training-evidence/verification-console.txt). Training and reevaluation logs are in [training evidence](training-evidence/README.md).
