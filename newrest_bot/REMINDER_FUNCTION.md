# Reminder Function Implementation

## Overview
The Reminder Function automatically sends course reminders to candidates the day before their scheduled training. It's designed to be bulletproof and efficient for production use on Render.com.

## How It Works

### 1. **Daily Scheduler**
- **Runs every day at 10:00 AM UTC** (Render.com timezone)
- **Single API call** to Google Sheets to get all candidates
- **Batch processes** all reminders at once
- **Prevents duplicate reminders** using tracking system

### 2. **Smart Candidate Filtering**
- Finds candidates with `STATUS = "WAITING"`
- Filters by `COURSE_DATE = "tomorrow"`
- Only processes candidates who haven't received reminders yet

### 3. **Reminder Message**
- **Localized messages** (Greek/English based on user preference)
- **Inline keyboard** with two options:
  - ✅ **Yes, I will attend** → Updates status to "WORKING"
  - ❌ **No, I cannot attend** → Updates status to "RESCHEDULE"

## Features

### ✅ **Bulletproof Design**
- **Retry mechanism** for failed operations
- **Comprehensive error handling** and logging
- **Graceful degradation** if Google Sheets is down
- **Memory efficient** with no memory leaks

### ✅ **Production Ready**
- **UTC timezone handling** for Render.com
- **Rate limiting** (1 second delay between sends)
- **Duplicate prevention** system
- **Graceful shutdown** handling

### ✅ **Smart Data Management**
- **Single API call** to Google Sheets
- **Efficient filtering** in memory
- **Column name flexibility** (handles spaces in headers)
- **Row-based updates** for accurate data modification

## File Structure

```
src/services/ReminderService.ts    # Main reminder service
src/bot/Bot.ts                    # Bot integration & startup
```

## Testing

### **Manual Test Command**
Use `/testreminder` in Telegram to manually trigger the reminder process:

```
/testreminder
```

This will:
1. Process all candidates who need reminders today
2. Send reminder messages (if any candidates found)
3. Show completion status
4. Log detailed information

### **Test Scenarios**
1. **No candidates** → Logs "No candidates need reminders today"
2. **Candidates found** → Sends reminders and logs details
3. **Error handling** → Gracefully handles failures

## Configuration

### **Environment Variables**
- `BOT_TOKEN` - Telegram bot token
- `GOOGLE_SHEETS_ID` - Google Sheets spreadsheet ID
- `GOOGLE_SERVICE_ACCOUNT_PATH` - Service account credentials

### **Schedule Settings**
- **Time**: 10:00 AM UTC daily
- **Timezone**: UTC (Render.com standard)
- **Cron**: `0 10 * * *`

## Google Sheets Integration

### **Required Columns**
The service looks for these columns in the "Registration" sheet:
- `STATUS` - Current candidate status
- `COURSE_DATE` - Scheduled course date
- `USERID` - Telegram user ID
- `NAME` - Candidate name
- `LANGUAGE` - User language preference

### **Data Flow**
1. **Read** all data from Registration sheet
2. **Filter** by STATUS = "WAITING" and COURSE_DATE = tomorrow
3. **Send** reminders to filtered candidates
4. **Update** STATUS based on user response:
   - `WORKING` - User confirmed attendance
   - `RESCHEDULE` - User declined attendance

## Response Handling

### **User Confirms Attendance**
1. Updates `STATUS` to "WORKING"
2. Adds candidate to `WORKERS` sheet
3. Sends confirmation message
4. Logs the action

### **User Declines Attendance**
1. Updates `STATUS` to "RESCHEDULE"
2. Sends reschedule message
3. Logs the action

## Logging

### **Log Levels**
- `INFO` - Normal operations (reminders sent, status updates)
- `WARN` - Non-critical issues (no candidates found)
- `ERROR` - Critical failures (API errors, missing data)

### **Log Format**
```
[ReminderService] Daily reminder check triggered at 10:00 AM UTC
[ReminderService] Found 3 candidates for reminders on 2025-08-27
[ReminderService] Reminder sent to candidate John Doe (123456789) for course on 2025-08-27
[ReminderService] Candidate 123456789 confirmed attendance, status updated to WORKING
```

## Deployment on Render.com

### **Requirements**
- Node.js environment
- Environment variables configured
- Google Sheets API access

### **Startup Process**
1. Bot initializes
2. ReminderService starts
3. Cron scheduler activates
4. Daily reminders begin at 10:00 AM UTC

### **Monitoring**
- Check logs for daily reminder processing
- Monitor Google Sheets for status updates
- Verify candidate responses are processed

## Troubleshooting

### **Common Issues**

1. **No reminders sent**
   - Check if candidates have `STATUS = "WAITING"`
   - Verify `COURSE_DATE` format (YYYY-MM-DD)
   - Check Google Sheets API permissions

2. **Column not found errors**
   - Verify column names in Google Sheets
   - Check if headers are in Row 2
   - Ensure required columns exist

3. **Scheduler not starting**
   - Check bot startup logs
   - Verify cron package installation
   - Check timezone settings

### **Debug Commands**
- `/testreminder` - Manual trigger
- Check logs for detailed error information
- Verify Google Sheets data structure

## Future Enhancements

### **Potential Improvements**
- **Multiple reminder times** (morning + evening)
- **Customizable message templates**
- **Admin notification system**
- **Reminder history tracking**
- **Performance metrics**

### **Scalability**
- **Batch processing** for large candidate lists
- **Queue system** for high-volume scenarios
- **Caching** for frequently accessed data

## Summary

The Reminder Function is a robust, production-ready system that:
- ✅ Automatically sends daily course reminders
- ✅ Handles user responses efficiently
- ✅ Updates Google Sheets accurately
- ✅ Provides comprehensive logging
- ✅ Works reliably on Render.com
- ✅ Prevents duplicate reminders
- ✅ Supports multiple languages

**Ready for production use!** 🚀
