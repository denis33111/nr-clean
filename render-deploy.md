# 🚀 Render Deployment Guide

## Prerequisites
- GitHub account with your bot repository
- Render account (free at render.com)

## Step 1: Prepare Your Repository

1. **Commit all changes:**
   ```bash
   git add .
   git commit -m "Prepare for Render deployment"
   git push origin main
   ```

## Step 2: Deploy on Render

1. **Go to [render.com](https://render.com) and sign up/login**

2. **Click "New +" → "Web Service"**

3. **Connect your GitHub repository:**
   - Select your bot repository
   - Choose the main branch

4. **Configure the service:**
   - **Name:** `telegram-bot`
   - **Environment:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`

5. **Set Environment Variables:**
   - `BOT_TOKEN` = Your Telegram bot token
   - `BOT_USERNAME` = Your bot username
   - `GOOGLE_SHEETS_ID` = Your Google Sheets ID
   - `ADMIN_IDS` = Your admin user IDs
   - `ADMIN_GROUP_ID` = Your admin group ID
   - `ADMIN_USER_IDS` = Your admin user IDs (comma-separated)

6. **Click "Create Web Service"**

## Step 3: Monitor Deployment

- Watch the build logs for any errors
- Check the health endpoint: `https://your-app.onrender.com/health`
- Monitor bot functionality in Telegram

## Step 4: Verify Bot is Working

1. **Check Render logs** for any errors
2. **Test bot commands** in Telegram
3. **Verify Google Sheets integration**
4. **Check admin functions**

## Troubleshooting

- **Build fails:** Check package.json and dependencies
- **Bot not responding:** Verify BOT_TOKEN is correct
- **Database errors:** Check DATABASE_URL path
- **Google Sheets errors:** Verify service account credentials

## Cost
- **Free tier:** 750 hours/month (perfect for development)
- **Paid:** $7/month when you need more resources
