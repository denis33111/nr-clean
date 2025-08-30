# Worker Bot - Credentials & Setup Notes

## Required Credentials

### 1. Telegram Bot
- **Bot Token**: 8251840085:AAFwgz1rVlaC8YXrkSRWhgWKK7JUQg_BLfI
- **Bot Username**: @NR_ASSISTANT_HELPER_BOT
- **Admin Group ID**: -4963327393 (NEWREST_GROUP)

### 2. Google Sheets
- **Spreadsheet ID**: 1zjVhBy0-SgK8tCM5rMSBaqgrJd1Kuwf1aZid9qHIWaE
- **Spreadsheet URL**: https://docs.google.com/spreadsheets/d/1zjVhBy0-SgK8tCM5rMSBaqgrJd1Kuwf1aZid9qHIWaE/edit?usp=sharing
- **Service Account JSON**: ✅ newrest-465515-8f12db11a64d.json (ready)
- **Sheet Names**: 
  - Main sheet: PERSONAL DATA + PROCESS EVENTS
  - WORKERS sheet: For active workers (check-in/out)
- **Structure**: 
  - Row 1: Section headers (PERSONAL DATA, DOCUMNETS, PROCESS EVENTS)
  - Row 2: Column headers (LANGUAGE, user id, DATE, NAME, AGE, PHONE, EMAIL, ADRESS, TRANSPORT, BANK, DR LICENCE, CRIMINAL RECORD, HEALTH CERT., AMKA, AMA, AFM, STATUS, COURSE_DATE)
  - Row 3+: Data rows

### 3. Server Deployment
- **Render.com Account**: For hosting the web service
- **Domain**: Your Render.com app URL for webhook configuration

## Environment Variables Needed

```env
# Telegram Configuration
BOT_TOKEN=your_telegram_bot_token_here
BOT_USERNAME=your_bot_username
ADMIN_GROUP_ID=your_admin_group_id

# Google Sheets Configuration
GOOGLE_SHEETS_ID=your_spreadsheet_id
GOOGLE_SERVICE_ACCOUNT_PATH=./credentials/service-account.json

# Server Configuration
PORT=3000
NODE_ENV=production

# Optional
LOG_LEVEL=info
```

## Setup Requirements

### 1. Google Cloud Setup
- Enable Google Sheets API
- Create service account
- Download JSON credentials
- Share Google Sheets with service account email

### 2. Telegram Bot Setup
- Create bot with @BotFather
- Get bot token
- Create admin group
- Add bot to admin group
- Get group ID

### 3. Render.com Setup
- Connect GitHub repository
- Set environment variables
- Configure webhook URL

## File Structure Needed

```
project/
├── credentials/
│   └── service-account.json
├── src/
├── package.json
├── .env
└── render.yaml
```

## Next Steps
1. Gather all credentials listed above
2. Set up Google Cloud service account
3. Create Telegram bot and admin group
4. Prepare Render.com account
5. Start coding the bot

## Notes
- Keep credentials secure and never commit to Git
- Test locally before deploying to Render.com
- Verify webhook configuration works properly
- Ensure Google Sheets permissions are correct
