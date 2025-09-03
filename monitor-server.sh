#!/bin/bash

# Server Monitoring Script for Telegram Bot
# Run this script to check if your server is alive and healthy

SERVER_URL="${WEBHOOK_URL:-https://telegram-bot-5kmf.onrender.com}"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "🔍 Server Health Check - $TIMESTAMP"
echo "=================================="

# Check basic health
echo "📊 Basic Health Check:"
if curl -s "$SERVER_URL/health" > /dev/null; then
    echo "✅ Server is responding"
    HEALTH_RESPONSE=$(curl -s "$SERVER_URL/health")
    echo "   Response: $HEALTH_RESPONSE"
else
    echo "❌ Server is not responding"
    exit 1
fi

echo ""

# Check detailed status
echo "📈 Detailed Status:"
if curl -s "$SERVER_URL/status" > /dev/null; then
    STATUS_RESPONSE=$(curl -s "$SERVER_URL/status")
    echo "✅ Status endpoint working"
    
    # Extract key information using jq if available, otherwise use grep
    if command -v jq &> /dev/null; then
        echo "   Uptime: $(echo $STATUS_RESPONSE | jq -r '.uptime // "N/A"') seconds"
        echo "   Memory: $(echo $STATUS_RESPONSE | jq -r '.memory.heapUsed // "N/A"') bytes used"
        echo "   Pending Reminders: $(echo $STATUS_RESPONSE | jq -r '.reminderService.pendingReminders // "N/A"')"
    else
        echo "   Response: $STATUS_RESPONSE"
    fi
else
    echo "❌ Status endpoint not working"
fi

echo ""

# Check if server is alive with response time
echo "⏱️  Response Time Test:"
START_TIME=$(date +%s.%N)
curl -s "$SERVER_URL/health" > /dev/null
END_TIME=$(date +%s.%N)
RESPONSE_TIME=$(echo "$END_TIME - $START_TIME" | bc -l 2>/dev/null || echo "N/A")
echo "   Response time: ${RESPONSE_TIME}s"

echo ""

# Check if server is accessible from internet
echo "🌐 Internet Accessibility:"
if curl -s --max-time 10 "$SERVER_URL" > /dev/null; then
    echo "✅ Server is accessible from internet"
else
    echo "❌ Server may not be accessible from internet"
fi

echo ""
echo "📝 Monitoring completed at $TIMESTAMP"
echo "💡 Run this script every few hours to monitor server health"
echo "🔗 Server URL: $SERVER_URL"
