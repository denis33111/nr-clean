# Admin System Documentation

## Overview
The admin system allows administrators to evaluate candidates who have completed the registration process and decide whether to proceed with them to the next stage.

## Features

### 1. Admin Notifications
- **Automatic Notification**: When a user completes registration, admins receive a notification in the admin group
- **Interactive Button**: Admins can click "Start evaluation" to begin the evaluation process
- **Language Support**: Notifications are sent in the same language the candidate used

### 2. Admin Commands
- **`/pending2`**: Shows a list of all candidates waiting for Step-2 evaluation
- **Admin Only**: Commands only work for users with admin privileges in the Telegram group

### 3. Evaluation Flow
The admin evaluation consists of 3 steps:

1. **Continue with candidate?** (Ναι/Όχι)
   - Options: Ναι (Yes), Όχι (No)
   - Determines if candidate proceeds or is rejected

2. **Position** (Θέση)
   - Options: HL, Supervisor, EQ
   - Records the position the candidate is being considered for

3. **Course Date** (Ημερομηνία εκπαίδευσης)
   - **Option 1**: Next Thursday/Friday (9:50-15:00)
   - **Option 2**: Week after next Thursday/Friday (9:50-15:00)  
   - **Option 3**: 📅 Custom date (admin types YYYY-MM-DD format)

## Setup

### Environment Variables
Add to your `.env` file:
```bash
ADMIN_GROUP_ID=-1001234567890  # Your Telegram admin group ID
```

### Admin Group Requirements
- Must be a Telegram group (not channel)
- Admin users must have "Administrator" or "Creator" role
- The bot must be added to the group

## Usage

### For Admins

1. **View Pending Candidates**
   ```
   /pending2
   ```

2. **Start Evaluation**
   - Click on a candidate from the pending list
   - Answer the evaluation questions
   - System automatically saves the decision

3. **Evaluation Results**
   - **Approved**: Status → WAITING (ready for next stage)
     - Candidate receives congratulations message with position and course date
     - Admin sees confirmation message
   - **Rejected**: Status → STOP (not proceeding)
     - Candidate receives polite rejection message
     - Admin sees rejection confirmation

### For Bot Operators

1. **Monitor Logs**: Check bot logs for admin actions
2. **Session Management**: Sessions automatically expire after 30 minutes of inactivity
3. **Memory Cleanup**: Automatic cleanup every 10 minutes
4. **Candidate Notifications**: All candidates receive appropriate messages after admin decision

### For Candidates

1. **Approval**: Receive congratulations message with position and course details
2. **Rejection**: Receive polite rejection message
3. **Language Support**: Messages sent in the same language used during registration

## Technical Details

### Files
- `src/services/AdminService.ts` - Admin permission checking
- `src/services/AdminNotificationService.ts` - Sending notifications
- `src/bot/flows/AdminStep2Flow.ts` - Main evaluation flow
- `src/bot/Bot.ts` - Integration and event handling

### Security
- Admin status verified via Telegram group permissions
- Session-based evaluation with automatic cleanup
- Input validation and error handling

### Integration
- Works with existing Google Sheets setup
- Extends current bot architecture
- Maintains existing user registration flow

## Future Enhancements

1. **Database Integration**: Store admin decisions in database
2. **Advanced Permissions**: Role-based access control
3. **Audit Trail**: Track all admin decisions and changes
4. **Bulk Operations**: Handle multiple candidates at once
5. **Custom Questions**: Configurable evaluation questions per position

## Troubleshooting

### Common Issues

1. **"ADMIN_GROUP_ID not set"**
   - Check your `.env` file
   - Ensure the variable is properly set

2. **"User is not admin"**
   - Verify user has admin role in Telegram group
   - Check bot has access to group

3. **"Required columns not found"**
   - Ensure Google Sheets has STEP2 and NAME columns
   - Check column names match exactly

### Debug Mode
Enable debug logging by checking bot logs for:
- `[AdminStep2Flow]` prefixed messages
- Admin permission checks
- Session management activities
