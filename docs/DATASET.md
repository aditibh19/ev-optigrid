# Dataset documentation

## ACN hourly charging energy

The uploaded `acn_hourly_load.csv` is an hourly derivative of Caltech Adaptive Charging Network session measurements. The included upstream quality summary reports 85,877 session files found, 85,870 processed and 7 failed. It also reports 288,618,248 processed and 160,081,049 skipped intervals. Those counts come from the uploader's preprocessing summary. This project validates the 104,995 derived CSV rows independently. The raw session files were outside this training run.

| Column | Type and unit | Meaning and use |
| --- | --- | --- |
| `timestamp_utc` | ISO 8601 UTC hour | Site time index and cyclic features |
| `site_id` | String | Garage/site key and one-hot input |
| `energy_kwh` | Nonnegative decimal, kWh | Estimated energy delivered in the hour. Past input and next-24-hour target |
| `active_sessions` | Nonnegative integer | Sessions spanning that hour. Past values only |
| `observed_energy` | Binary | The preprocessor integrated an energy measurement for the hour. Input mask and target eligibility |

| Site | Hourly rows | Measured hours | Unmeasured hours | Measured zeros |
| --- | ---: | ---: | ---: | ---: |
| caltech/California_Garage_01 | 22,732 | 16,854 | 5,878 | 2,991 |
| caltech/California_Garage_02 | 17,713 | 14,892 | 2,821 | 3,181 |
| caltech/LIGO_01 | 7,325 | 882 | 6,443 | 228 |
| caltech/N_Wilson_Garage_01 | 8,816 | 7,487 | 1,329 | 2,106 |
| caltech/S_Wilson_Garage_01 | 14,722 | 8,510 | 6,212 | 2,379 |
| jpl/Arroyo_Garage_01 | 18,870 | 2,409 | 16,461 | 386 |
| office_01/Parking_Lot_01 | 14,817 | 4,409 | 10,408 | 595 |
| **Total** | **104,995** | **55,443** | **49,552** | **11,866** |

The file spans 2018-05-01 through 2020-12-05 UTC. Validation checks exact fields, a unique key per site/hour, valid UTC hour boundaries, nonnegative finite energy, integer sessions and binary flags. It found zero gaps in the seven raw hourly grids. Unmeasured hours are excluded from target loss and metrics even when the CSV contains zero. Measured zeros remain eligible. The modeling timeline omits 14,832 leading unmeasured hours at JPL. The original CSV stays intact.

The largest reported hour is 3,066.669 kWh at N Wilson. A California Garage 01 hour reports 2,790.960 kWh. The packaged benchmark retains these flagged-for-review values because the source interval files required to verify them are unavailable here. The N Wilson extreme falls in the test period and materially affects RMSE. Measurement coverage varies by site and the test scores describe the observed subset.

## EV catalogue

The uploaded `electric_vehicles_spec_2025.csv.csv` is bundled under the name `ev_specifications.csv`. It has 478 records and 22 columns. Each entry includes a source link to EV-Database. Links are retained as provenance. No external source data was fetched during training.

| Column | Meaning and unit |
| --- | --- |
| `brand` | Vehicle make |
| `model` | Model or variant name |
| `top_speed_kmh` | Top speed in km/h |
| `battery_capacity_kWh` | Catalogue battery capacity in kWh |
| `battery_type` | Battery chemistry description |
| `number_of_cells` | Number of cells where supplied |
| `torque_nm` | Torque in newton-metres |
| `efficiency_wh_per_km` | Rated energy consumption in Wh/km |
| `range_km` | Published range in km |
| `acceleration_0_100_s` | Seconds from 0 to 100 km/h |
| `fast_charging_power_kw_dc` | Catalogue peak DC charging power in kW |
| `fast_charge_port` | DC connector type |
| `towing_capacity_kg` | Towing mass in kg |
| `cargo_volume_l` | Cargo volume, normally litres |
| `seats` | Seat count |
| `drivetrain` | AWD, FWD, or RWD in this upload |
| `segment` | Vehicle market segment |
| `length_mm` | Vehicle length in mm |
| `width_mm` | Vehicle width in mm |
| `height_mm` | Vehicle height in mm |
| `car_body_type` | Vehicle body style |
| `source_url` | Source vehicle record URL |

Validation checks the 22-column schema, duplicate source URLs, finite positive battery capacity, efficiency and range, plus positive DC power where supplied. The validator reports 202 missing cell counts, seven missing torque values, 26 missing towing capacities, one missing model name, one missing DC rating, one missing connector and one missing cargo value. Three additional cargo entries use a banana-box count instead of litres. They remain source text and have no effect on the app. The selector labels the unnamed variant as **Unnamed model**. Unknown DC compatibility blocks DC planning for that record. AC onboard power is a user assumption because the file supplies DC power only.

## Relationship and lineage

The files are independent. ACN drives site-level demand inference. EV specs drive vehicle selection, battery calculations, and connector checks. An EV model ID in a charge plan identifies a catalogue entry only. The application infers neither the model mix of the ACN fleet nor charger-level availability.

The generated `ml/artifacts/data-quality.json` records exact source SHA-256 digests, column lists, per-site coverage and measured counts by partition.
