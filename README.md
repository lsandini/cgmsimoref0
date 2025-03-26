# cgmsim-oref0

A lightweight, functional implementation of the OpenAPS algorithm that connects to Nightscout for data exchange and treatment decisions.

## Overview

cgmsim-oref0 is a Node.js application that runs the OpenAPS algorithm in a serverless, stateless manner. It fetches glucose readings and treatment data from Nightscout, calculates recommended insulin dosing, and uploads treatments and device status back to Nightscout.

## Architecture

The application follows a functional programming approach with clear separation of concerns:

```
/api             - External API interactions
/transforms      - Data transformation and formatting
/algorithms      - Core algorithm calculations  
/utils           - Utility functions and helpers
```

## Key Components

- **Scheduler (`app.js`)**: Runs the algorithm every 5 minutes using node-cron
- **Loop Controller (`mpc.js`)**: Orchestrates the entire algorithm execution flow
- **Nightscout Client**: Handles all interactions with Nightscout API
- **Algorithm Modules**:
  - Insulin on Board (IOB) calculations
  - Carbs on Board (COB) calculations
  - Autosensitivity detection
  - Basal rate determination

## Features

- Stateless execution model suitable for serverless environments
- Full OpenAPS algorithm implementation including:
  - Dynamic insulin sensitivity adjustments (autosens)
  - Super Micro Bolus (SMB) for faster BG corrections
  - Carb absorption tracking
  - Temporary basal rate recommendations
- Configurable algorithm parameters via preferences.json
- Detailed logging for troubleshooting

## Configuration

Two main configuration files:
- `config.json`: Core application settings
- `preferences.json`: Algorithm behavior parameters

Additionally, environment variables can be set through `.env`:
```
NIGHTSCOUT_URL=https://your-nightscout-site.herokuapp.com
NIGHTSCOUT_API_SECRET=your-api-secret
```

## Usage

1. Install dependencies: `npm install`
2. Configure your Nightscout URL and API secret
3. Start the application: `npm start`

The application will run in the background, executing the OpenAPS algorithm every 5 minutes and communicating with your Nightscout site.

## Dependencies

- oref0: The core OpenAPS algorithm library
- node-fetch: For API communication
- node-cron: For scheduling
- dotenv: For environment variable management

## License

ISC
