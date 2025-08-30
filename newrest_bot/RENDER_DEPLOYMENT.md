# Render Deployment Guide for Newrest Worker Bot

## Prerequisites
- GitHub repository with your bot code
- Render account (free tier available)
- Telegram bot token
- Google Sheets API credentials

## Step 1: Prepare Your Repository
1. Ensure all code is committed and pushed to GitHub
2. Verify `.gitignore` excludes sensitive files (credentials, .env)
3. Check that `render.yaml` is in your root directory

## Step 2: Deploy on Render

### Option A: Using render.yaml (Recommended)
1. Go to [render.com](https://render.com) and sign in
2. Click "New +" → "Blueprint"
3. Connect your GitHub repository
4. Render will automatically detect the `render.yaml` configuration
5. Click "Apply" to deploy

### Option B: Manual Deployment
1. Go to [render.com](https://render.com) and sign in
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure the service:
   - **Name**: `newrest-worker-bot`
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free

## Step 3: Configure Environment Variables
In your Render service dashboard, add these environment variables:

### Required Variables:
- `BOT_TOKEN`: Your Telegram bot token
- `ADMIN_GROUP_ID`: Your admin group ID
- `GOOGLE_SHEETS_ID`: Your Google Sheets document ID
- `GOOGLE_SERVICE_ACCOUNT_PATH`: `./credentials/newrest-465515-8f12db11a64d.json`

### Optional Variables:
- `NODE_ENV`: `production`
- `PORT`: `3000` (auto-set by Render)

## Step 4: Upload Google Credentials
1. In your Render service dashboard, go to "Files" tab
2. Create a `credentials` folder
3. Upload your `newrest-465515-8f12db11a64d.json` file
4. Ensure the file path matches `GOOGLE_SERVICE_ACCOUNT_PATH`

## Step 5: Set Webhook URL
1. After deployment, copy your Render app URL
2. Set the webhook URL in your bot:
   ```
   https://your-app-name.onrender.com/webhook
   ```
3. Add this as `WEBHOOK_URL` environment variable in Render

## Step 6: Test Your Bot
1. Send `/start` to your bot
2. Check Render logs for any errors
3. Verify webhook is working by checking bot status

## Troubleshooting

### Common Issues:
1. **Build Failures**: Check Node.js version compatibility
2. **Environment Variables**: Ensure all required vars are set
3. **Google Sheets Access**: Verify credentials file is uploaded correctly
4. **Webhook Issues**: Check if webhook URL is accessible

### Logs:
- Check Render service logs for detailed error information
- Use `console.log` or logger for debugging

## Monitoring
- Render provides automatic health checks at `/health` endpoint
- Monitor your service status in the Render dashboard
- Set up alerts for service failures

## Scaling
- Free tier: 750 hours/month
- Upgrade to paid plans for 24/7 operation
- Consider using Render's cron jobs for maintenance tasks

## Security Notes
- Never commit `.env` files or credentials
- Use Render's environment variable encryption
- Regularly rotate API keys and tokens
- Monitor access logs for suspicious activity
