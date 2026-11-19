# Model training and evaluation

The following metrics were produced by the packaged TensorFlow.js training run. The underlying epoch records, metric arrays, execution log, example test predictions and checkpoint hashes are in [training evidence](training-evidence/README.md).

| Model | Validation MAE (kWh) | Validation RMSE (kWh) | Test MAE (kWh) | Test RMSE (kWh) |
| --- | ---: | ---: | ---: | ---: |
| Weekly seasonal naïve | 9.5204 | 29.8279 | 9.4239 | 67.0981 |
| LSTM | **8.0279** | **24.6240** | **8.2755** | 63.2653 |
| CNN–BiLSTM–Attention | 8.4058 | 24.7673 | 8.4814 | **63.1986** |

The LSTM is the dashboard default because it had the lowest **validation MAE**. The hybrid reduced test MAE by about 10.0% versus weekly seasonal naïve and test RMSE by about 5.8%. It had a slightly lower test RMSE than the LSTM and a higher test MAE. This experiment does not establish that the hybrid beats the LSTM overall.

## Split and eligibility

All seven sites use common UTC cutoffs. The earliest time with all seven modeled timelines available was 2020-06-18 00:00 UTC. The first exclusive end among those sites was 2020-12-02 00:00 UTC. The 70% and 85% points of this shared calendar span define these boundaries:

| Partition | Target timestamp interval |
| --- | --- |
| Training | Before 2020-10-12 21:00 UTC |
| Validation | From 2020-10-12 21:00 through 2020-11-06 21:00 UTC |
| Test | From 2020-11-06 22:00 UTC through that site's recorded end |

Earlier observations extend the training partition for sites with longer coverage. Each scored origin's full 24-hour label interval stays within its partition. The 168-hour lookback may include past measurements from an earlier partition, which would have been available at forecast time. A horizon may include missing labels, but an origin must have at least one measured target. Validation and test are one-hour rolling-origin evaluations. Repeated hour targets at different origins are separate forecasts, so pair counts are larger than the number of independent site-hour observations.

The full validation scored 58,831 measured origin–horizon pairs across 3,678 origins. The test scored 57,679 across 3,573 origins. Site scaling and seasonal fallback statistics were estimated solely on the training data. Future active-session counts are excluded.

## Training parameters

| Setting | Packaged experiment |
| --- | --- |
| Framework | TensorFlow.js 4.22 on Node 22, with the native Linux CPU backend for training |
| Input and output | 168 hourly steps across 14 features, direct output of 24 hourly predictions |
| Training origins | 17,129, stride 4 |
| Checkpoint validation origins | 921, stride 4 |
| Optimization | Adam, learning rate 0.002, batch size 128 |
| Loss | Masked MSE after per-site RMS scaling from measured train hours |
| Checkpoint selection | Lowest validation loss, with early-stopping patience 3 and 10-epoch cap |
| LSTM | Six-hour average pooling, 12 unidirectional LSTM units, dense 24-output head, 1,608 parameters |
| Hybrid | 12 filters, kernel 12, stride 6, 12 LSTM units per direction, temporal attention, dense 24-output head, 5,052 parameters |
| Epochs | LSTM completed 10, best checkpoint 10. Hybrid stopped after 9, best checkpoint 6 |

## Interpretation

MAE is the average absolute error. RMSE squares the errors before averaging and is sensitive to unusually high recorded energy. The 3,066.669 kWh N Wilson test hour is preserved and appears in multiple overlapping forecasts. Sparse measurements at LIGO and the office site limit conclusions about those sites. `metrics.json` includes per-site and per-horizon results. The dashboard's example uses a high-coverage replay window to show the shape of the daily curve. The benchmark includes all eligible origins.

No live data or forecasts for modern usage patterns are validated here. The recorded period includes 2020. The experiment measures model fit on this historical dataset and does not measure energy or cost savings at a real charger.
