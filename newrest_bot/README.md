# Newrest Worker Bot

A Telegram bot for worker registration and check-in/out system.

## Features

- **Worker Registration**: Complete registration flow with language support (EN/GR)
- **User Recognition**: Automatically detects if user is registered or new
- **Check-in/out System**: Location-based authentication for working users
- **Admin Evaluation**: Interactive admin system for candidate evaluation
- **Google Sheets Integration**: Stores all data in Google Sheets
- **Webhook Support**: 24/7 operation on Render.com

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```

### 3. Google Sheets Setup
- Place your service account JSON file in `credentials/` folder
- Update `GOOGLE_SERVICE_ACCOUNT_PATH` in `.env`

### 4. Build Project
```bash
npm run build
```

### 5. Start Bot
```bash
npm start
```

## Development

```bash
# Development mode with hot reload
npm run dev

# Watch mode
npm run watch

# Linting
npm run lint

# Formatting
npm run format
```

## Project Structure

```
src/
├── bot/                    # Bot core functionality
│   ├── Bot.ts            # Main bot class
│   └── flows/            # User flow handlers
│       ├── RegistrationFlow.ts
│       └── CheckInOutFlow.ts
├── services/              # Business logic
│   └── UserRecognitionService.ts
├── utils/                 # Utilities
│   ├── Logger.ts         # Logging system
│   └── GoogleSheetsClient.ts
└── index.ts              # Application entry point
```

## Environment Variables

- `BOT_TOKEN`: Telegram bot token
- `BOT_USERNAME`: Bot username
- `ADMIN_GROUP_ID`: Admin group ID for notifications
- `GOOGLE_SHEETS_ID`: Google Sheets document ID
- `GOOGLE_SERVICE_ACCOUNT_PATH`: Path to service account JSON

## License

MIT
