# Training data

`occupancy.csv` and `inf.csv` come from the UrbanEV dataset, taken from the public GitHub
repository https://github.com/IntelligentSystemsLab/UrbanEV (folder `data/`).

- `occupancy.csv`: hourly count of occupied charging piles in 275 traffic zones of Shenzhen, China,
  from 2022-09-01 to 2023-02-28 (4344 hours).
- `inf.csv`: one row per station with zone id (TAZID), location and number of piles.
  EarthVein sums the piles per zone to turn counts into an occupancy ratio.

License of the repository: CC0 1.0 Universal (the LICENSE file in the repo).

Please cite the dataset paper if you reuse it:
H. Li, H. Qu, X. Tan, L. You, R. Zhu, W. Fan, "UrbanEV: An open benchmark dataset for urban electric
vehicle charging demand prediction", Scientific Data, 2025, doi:10.1038/s41597-025-04874-4.
The full dataset (5 minute data, prices, volumes) is also on Dryad, doi:10.5061/dryad.np5hqc04z.

To refresh the files:

    curl -O https://raw.githubusercontent.com/IntelligentSystemsLab/UrbanEV/main/data/occupancy.csv
    curl -O https://raw.githubusercontent.com/IntelligentSystemsLab/UrbanEV/main/data/inf.csv
