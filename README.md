# pickmeup

## Description
This project calculates the optimal meeting point (`MEET`) for a passenger using public transit to be picked up by a driver, with both continuing to a final destination (`DEST`). The goal is to minimize the total travel time for both the passenger and the driver.

---

## Key Concepts and Terms

- **Passenger Origin (`orig`)**: The initial location of the passenger.
- **Driver Origin (`driver_orig`)**: The starting point of the driver.
- **Destination (`dest`)**: The final shared destination of the passenger and driver.
- **Meeting Point (`meet`)**: The optimal pick-up location for the passenger by the driver.

---

## Business Logic

### Step 1: Selecting Potential Passenger Start Points Near the Passenger's Initial Location

1. **Objective**: Identify nearby transit stations that can serve as potential starting points for the passenger’s journey toward the meeting point (`meet`).

2. **Heuristics**:
   - **Radius Constraint**: Limit potential stations to those within a 1 km radius of `orig`.
   - **Unique Station per Line**: For each transit line, select only the closest station to `orig`.

### Step 2: Determine the Worst-Case Driving Scenario

1. **Objective**: Establish a baseline travel time in case no alternative meeting points are optimal.
   
2. **Scenario**: In this scenario, the driver travels directly from `driver_orig` to `orig` to pick up the passenger, then continues to `dest`.
   - Here, `meet` is set to `orig`, meaning the passenger does not use transit.

---

## Example Scenario

Consider the following example with an initial setup:

- **Passenger Origin (`orig`)**: Location A
- **Driver Origin (`driver_orig`)**: Location B
- **Destination (`dest`)**: Final Destination

### Steps to Determine the Optimal Meeting Point

1. **Identify Nearby Transit Stations**:
   - Find all transit stations within a 1 km radius of `orig` (Location A).
   - For each transit line, select only the closest station to `orig`.

2. **Calculate Potential Meeting Points**:
   - For each candidate station from Step 1:
     - Determine the public transit travel time for the passenger from `orig` to each candidate station.
     - Calculate the driving time for the driver from `driver_orig` to the candidate station and then from the candidate station to `dest`.

3. **Evaluate Against Worst-Case Scenario**:
   - Calculate the total travel time for the worst-case scenario where the driver travels directly from `driver_orig` to `orig`, then continues to `dest`.
   - Compare each candidate station’s total travel time (Step 2) to the worst-case scenario.

4. **Select Optimal Meeting Point**:
   - Choose the station that minimizes the combined travel time for the passenger and driver.

---

## Expected Outputs

- **Optimal Meeting Point (`meet`)**: The station location that minimizes total travel time.
- **Baseline Travel Time**: Total travel time in the worst-case scenario.