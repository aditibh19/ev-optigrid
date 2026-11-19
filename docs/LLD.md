# Low-level design

## Repository map

| Path | Responsibilities |
| --- | --- |
| `ml/preprocess.js` | CSV validation, per-site time grids, split, missing-data mask, feature and label construction |
| `ml/model.js` | TensorFlow.js layers, temporal attention, masked loss and weight serialization |
| `ml/train.js`, `ml/evaluate.js` | Checkpoint training and comparison of held-out results |
| `ml/predict.js` | Artifact checks and single-origin inference |
| `optimization/` | SOC, tariff, connector and power validation, then hourly allocation |
| `simulator/` | Energy balance, virtual charger, drive depletion and loopback protocol demo |
| `backend/` | HTTP routes, MongoDB access, versioned twin updates and socket broadcasts |
| `frontend/src/` | Dashboard, charts, styles and REST/socket client |

## API

The first three data endpoints and health check are public within the local app. Record endpoints need `x-workspace-id` with a version-4 UUID. The dashboard generates a workspace once per browser origin and stores it in local storage.

| Method and path | Request | Response |
| --- | --- | --- |
| GET `/api/health` | — | Status from MongoDB ping |
| GET `/api/catalogue` | — | Sites, permitted replay dates, model default and vehicle records |
| GET `/api/metrics` | — | Training configuration, losses and validation/test breakdowns |
| GET `/api/data-quality` | — | Schema, SHA-256 digests, missingness and coverage |
| PUT `/api/profile` | `name`, `vehicleId` | Upserted local profile |
| GET `/api/profile` | — | Local profile or null |
| POST `/api/forecasts` | `siteId`, optional UTC-hour `origin` and `model` (`hybrid`, `lstm`, `seasonal`) | Forecast ID and 24 timestamped predictions and replay values |
| POST `/api/plans` | Forecast ID, vehicle ID and planning inputs below | Plan ID, schedule, feasibility, cost and earliest-charge reference |
| POST `/api/twins` | `planId` | Initial saved twin state |
| POST `/api/twins/:id/actions` | `action` of `start`, `pause`, or `drive`, plus `km` for driving | Updated version and state |
| GET `/api/{forecasts,plans,twins}` | Optional `planId` for twins | Recent workspace records, newest first, up to 15 |
| GET `/api/{forecasts,plans,twins}/:id` | Record ID in URL | One workspace record |

Example plan request body:

```json
{
  "forecastId": "replace-with-forecast-id",
  "vehicleId": "1",
  "startSoc": 25,
  "targetSoc": 75,
  "efficiency": 0.9,
  "deadline": 12,
  "chargerKw": 11,
  "vehicleAcKw": 11,
  "mode": "AC",
  "siteLimitKw": 100,
  "congestionRate": 0.12
}
```

For DC provide `mode: "DC"` and `connector` matching the catalogue. A custom `tariffs` array must supply one USD/kWh rate per slot through departure. JSON error responses use `error`. Codes include 400 for invalid input, 404 for an unknown scoped resource, 409 for a conflicting state change, and 422 for DC incompatibility.

## Storage

| Collection | Identity and links | Main fields |
| --- | --- | --- |
| profiles | Workspace UUID in `_id` | Name, favourite vehicle ID, creation time |
| forecasts | Record UUID plus workspace | Site, origin, model, mode, 24 hourly predictions and optional measured values |
| plans | Record UUID plus workspace, linked forecast ID | Vehicle ID, validated inputs, slot allocations, target, endpoint SOC, cost, shortfall |
| twins | Record UUID plus workspace, linked plan ID | Cursor, SOC, remaining range, lifecycle state, energy, event history, version |

Forecasts, plans and twins use an index on workspace and descending creation time. A second twin index supports scanning active simulations. State transitions use compare-and-set on `_id`, workspace and version. The server publishes only updates acknowledged by MongoDB. A conflicting HTTP action returns 409. An active simulation resumes when the server restarts. Elapsed wall-clock time while the server is down is ignored. The application assumes one Node worker, and caps each scan at 50 active twins.

## Forecast implementation

Each input row contains normalized measured energy, a measurement flag, log-scaled past session count, two daily UTC cyclic features, two weekly UTC cyclic features and a one-hot site vector. Missing energy uses a numeric zero placeholder and a mask of zero. Each target vector uses -1 as the loss-mask sentinel for unmeasured hours. Both networks emit a vector of 24 normalized predictions, rescaled by site and clamped at zero for evaluation and inference.

The hybrid uses a 12-filter 1D convolution with kernel 12 and stride 6, followed by a 12-unit LSTM in each direction. The resulting 28 vectors each have width 24. Attention scores each vector with a learned dot product followed by tanh, normalizes across the 28 positions with softmax, then sums the weighted vectors. A dense regressor maps the context vector to 24 outputs. Bidirectionality spans only historical inputs. Attention weights are neither causal explanations nor proof that individual hours drive demand.

The LSTM baseline averages nonoverlapping six-hour blocks, applies a 12-unit unidirectional LSTM and sends the last state to a 24-output dense layer. Seasonal naïve copies the energy at the same hour one week earlier. If that reading is missing, it uses the training-only site hour-of-week mean or, where unavailable, the training-only site mean.

## Optimization

For one-hour slot `t`, compute candidate grid energy cap `u[t] = min(vehicle/charger rate limit, max(0, site limit − predicted hourly kWh))`. One-hour mean kW and kWh have the same numeric value. Requested grid energy is `capacity × (targetSOC − openingSOC) / (100 × efficiency)`.

Minimize `sum(x[t] × (tariff[t] + congestionRate × forecastKwh[t] / siteLimitKw))` subject to `0 ≤ x[t] ≤ u[t]` and total delivered grid energy equalling the feasible part of the request. Because energy is divisible, slot costs are linear, and no ramping or inter-slot rules apply, filling slots from lowest marginal objective cost is optimal by an exchange argument. The cost reference fills earliest slots first. The optimized cost can exceed that reference's tariff-only cost when congestion is weighted, so both objective and tariff cost are retained.

## Twin and socket contract

The twin adds `grid energy × charging efficiency` to the battery for each slot and clips at the requested target. A drive consumes energy at `efficiencyWhKm` and stops early when the virtual battery is empty. Estimated range uses remaining battery energy divided by the catalogue efficiency. Temperature, charge taper, battery degradation, auxiliary loads and terrain are outside this linear model.

Pass the workspace UUID as `auth.workspace` during the Socket.IO handshake. The server joins that workspace's room, then emits `twin:update` with the saved twin including `id`, `version`, `status`, `soc`, range and events. Reconnect via GET to catch up. The OCPP loopback demo lives in a separate command and does not accept external connections.

## Site comparison and station metering

GET `/api/plans/:id/sites` loads a workspace-owned plan, forecasts each eligible ACN site at its saved origin using the same model, then optimizes using identical vehicle and scenario inputs. Results rank feasible sites first, then minimize remaining shortfall and weighted objective. Sites outside their recorded prediction range are omitted. The comparison assumes equal scenario charger availability and tariff at each site.

Each simulation tick sends cumulative virtual grid energy to an application-owned loopback WebSocket gateway using an OCPP 1.6J MeterValues call. The gateway validates the reading and returns a correlated acknowledgement. MongoDB commits the receipt and battery transition together under the twin version check. A failed exchange leaves the slot pending for retry. Socket.IO sends the committed record to the dashboard. Meter timestamps are slot-end UTC times.
