# EV-OptiGrid 2.0

## Project in simple words

EV-OptiGrid answers two questions. How much charging demand can a site expect over the next 24 hours? When should an EV charge so it can reach the desired battery level by departure at a lower modeled cost or congestion level?

We use two uploads. The ACN file has 104,995 historical site-hour records from seven charging locations. It provides measured charging energy and past session counts for model training. The second file has 478 EV catalogue records. It supplies battery size, driving efficiency, range, and DC charging specifications for the vehicle selector and battery simulation. ACN contains no matching model IDs, so the datasets meet in the planner rather than in a database join.

The forecasting pipeline uses the prior seven days of hourly data to predict the following 24 hours. Its main model learns short patterns with a CNN, reads the historical sequence with a bidirectional LSTM, and weights the sequence with attention. An LSTM and a weekly seasonal formula serve as baselines. The evaluation scores only hours with measured energy after a shared calendar cutoff for all sites. The attached results show which model performed best under each metric.

After the forecast, the planner calculates how much grid energy the EV needs from its current SOC, target SOC, battery capacity and charging efficiency. It looks for low-cost or low-congestion hours while respecting charger power, assumed site headroom and time to departure. When there is insufficient charging time or headroom, it reports the reachable SOC and shortfall.

The React dashboard presents the forecast, plan, benchmark and digital twin. Express runs the APIs and coordinates the TensorFlow.js model. MongoDB stores records. Socket.IO updates SOC and estimated range in the browser as the simulator advances. The digital twin also models the battery energy used by a short virtual drive.

## What to show in the demo

1. Show the seven sites and explain the difference between a measured zero and an unmeasured hour.
2. Compare an actual and predicted holdout day. Show the test MAE and RMSE for all three models.
3. Pick a vehicle, enter a departure deadline and compare the recommended schedule to charging as soon as possible.
4. Run the simulated battery and then simulate a drive.
5. Reopen the saved plan to show MongoDB persistence.

The charging schedule uses a tariff scenario, not a utility bill. The power limits are assumptions and the battery telemetry is virtual. The project has no connection to a physical EV or charging station.

## Selecting a site and inspecting a session

Once a plan is saved, the user can compare available historical sites under identical assumptions. The resulting ranking shows whether the target is reachable and how much charging would cost at each site. During simulation the virtual station sends cumulative energy readings through an OCPP 1.6J gateway. Each acknowledged reading is saved alongside the battery state and displayed in the dashboard.
