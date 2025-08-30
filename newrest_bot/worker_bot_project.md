# Worker Bot Project Specification

## Project Overview
A Telegram bot for worker management that handles registration and check-in/out workflows, running 24/7 on a server.

## Core Requirements

### 1. Bot Functionality
- **Worker Registration Process**: Collect and store new worker information
- **Check-in/Check-out Flow**: Track worker shift start/end times
- **Location-based Authentication**: Workers authenticate by sharing their location
- **24/7 Availability**: Bot must run continuously on server

### 2. User Flow Segments
- **Segment 1: Registration**: New worker onboarding and data collection
- **Segment 2: Working State**: Active workers can check-in/out during their shifts
- **Contact Button**: Pinned button below message input field that redirects users to your DM

### 3. Technical Architecture
- **Platform**: Telegram Bot API
- **Webhook Method**: Real-time responses (not polling)
- **Server**: Render.com Web Service deployment
- **Storage**: Google Sheets integration (structure to be provided later)
- **Authentication**: Location sharing from workers

### 4. User Groups & Access
- **Workers**: Register, check-in/out, location sharing
- **Admin Group**: Second group for reporting and management features
- **Reporting**: Admin access to worker data and attendance records

### 5. Data Management
- **Registration Data**: Worker information (structure pending Google Sheets format)
- **Attendance Records**: Check-in/out timestamps with location data
- **Storage**: Google Sheets (no database required)
- **Security**: Basic level (no sensitive data concerns)

### 6. Deployment & Infrastructure
- **Hosting**: Render.com Web Service (not Worker)
- **Webhook Endpoint**: Persistent HTTP server for Telegram updates
- **24/7 Operation**: Continuous availability for worker interactions
- **Scalability**: Handle multiple simultaneous worker requests

## Technical Decisions Made
- ✅ Webhook over polling for real-time performance
- ✅ Web Service over Worker on Render.com for persistent HTTP endpoint
- ✅ Google Sheets for data storage (no database)
- ✅ Location-based authentication for check-in/out
- ✅ Admin group for reporting and management

## Google Sheets Structure

### Two Main Sheets

**1. "Registration" Sheet (Main data collection)**
- **PERSONAL DATA Section**: NAME, AGE, ADDRESS, PHONE, EMAIL, ADDRESS, TRANSPORT, BANK
- **DOCUMNETS Section**: DR LICENCE, CRIMINAL RECORD, HEALTH CERT, AMKA, AMA, AFM
- **PROCESS EVENTS Section**: STATUS, COURSE_DATE
- **Used for**: Registration flow (Segment 1)

**2. "WORKERS" Sheet (Active workers)**
- **Columns**: NAME, ID, STATUS, LANGUAGE
- **Used for**: Check-in/out flow (Segment 2)
- **Purpose**: Determines if user is registered worker or needs to register

### User Recognition Logic
```
Bot checks WORKERS sheet for user ID
├── User found in WORKERS → Check-in/out Flow (Segment 2)
└── User NOT found in WORKERS → Registration Flow (Segment 1)
```

## Pending Information
- Admin reporting requirements
- Server domain/URL for webhook configuration

## User Flow Tree

### Entry Point
```
User enters bot → /start command
```

### User Recognition Branch
```
Bot checks WORKERS sheet for user ID
├── User found in WORKERS sheet → Check-in/out Flow (Segment 2)
└── User NOT found in WORKERS sheet → Registration Flow (Segment 1)
```

### Registration Flow (Segment 1)
```
1. Language Selection (EN/GR)
   ├── Bot asks: "Please select your language / Παρακαλώ επιλέξτε γλώσσα"
   └── Options: English / Ελληνικά

2. Contact Button Setup
   └── Bot sends: "📱 Contact @DenisZgl" (always visible below message input)

3. Sequential Data Collection (one by one)
   ├── NAME → AGE → ADDRESS → PHONE → EMAIL
   ├── Dropdown Fields:
   │   ├── BANK: EURO_BANK, ALPHA_BANK, PIRAEUS_BANK, NATION_ALBANK
   │   ├── TRANSPORT: MMM, VEHICLE, BOTH
   │   ├── DR LICENCE: YES, NO
   │   └── CRIMINAL RECORD: YES, NO
   └── COURSE_DATE: Date input

4. Review & Edit Phase
   ├── Bot shows all collected data
   ├── Edit buttons for each field: ✏️ Name  ✏️ Age  ✏️ Address  etc.
   └── Confirm button: ✅ Confirm

5. Edit Flow (if needed)
   ├── User clicks edit → Bot asks that question again
   ├── User answers → Back to review
   └── Repeat until user confirms

6. Final Save
   └── Save to "Registration" sheet → STATUS: "WAITING"

7. Post-Validation Messages
   ├── Congratulations Message (EN/GR):
   │   ├── EN: "Congratulations! You have successfully passed the first stage. In the second stage you will have an interview with Newrest. You will be informed by one of our colleagues about the date and time of the interview."
   │   └── GR: "Συγχαρητήρια! Περάσατε με επιτυχία το πρώτο στάδιο. Στο δεύτερο στάδιο θα περάσετε από συνέντευξη με τη Newrest. Για την ημέρα και ώρα της συνέντευξης θα ενημερωθείτε από έναν συνάδελφό μας."
   ├── Location Map with Google Maps button
   ├── Document Requirements (detailed instructions in EN/GR):
   │   ├── EN: "Documents for work. - Color ID photo front and back. - Copy of criminal record. We type in Google: copy of criminal record, select the first one, follow the steps, connect with the TAXISnet codes, select YES at the bottom of the bars; when the application is made please send a photo of the QR code. Please let us know in case you cannot get the file in this way. - Health certificate. If you have never done it or if you have done it but it has been five years, we will get it for you. - Criminal record certificate. The file that has been sent to you can be validated using the gov.gr service 'Digital document certification'. Direct link: https://www.gov.gr/en/ipiresies/polites-kai-kathemerinoteta/psephiaka-eggrapha-gov-gr/psephiake-bebaiose-eggraphou Follow the steps: connect with TAXISnet, upload the file, choose signature in Greek, request SMS code, enter it and download the certified document. Then send us a clear photo of the QR code. - AFM, AMA, AMKA and your home address."
   │   └── GR: "Έγγραφα για εργασία. - Έγχρωμη φωτογραφία ταυτότητας μπροστά και πίσω όψη. - Αντίγραφο ποινικού μητρώου. Πληκτρολογούμε στο Google: αντίγραφο ποινικού μητρώου, επιλέγουμε το πρώτο, ακολουθούμε τα βήματα, συνδεόμαστε με τους κωδικούς taxisnet, επιλέγουμε ΝΑΙ κάτω κάτω στις μπάρες, γίνεται η αίτηση και στέλνουμε φωτογραφία το QR code. Ενημερώνουμε σε κάθε περίπτωση αν δεν μπορεί να βγει το αρχείο με αυτό τον τρόπο. - Πιστοποιητικό υγείας. Εάν δεν έχουμε κάνει ποτέ ή έχουμε κάνει και έχουν περάσει πέντε χρόνια, τότε το βγάζουμε εμείς. - Υπεύθυνη δήλωση ποινικού μητρώου. Το αρχείο που σας έχει αποσταλεί, το επικυρώνουμε με Ψηφιακή βεβαίωση εγγράφου στο gov.gr (υπηρεσία: 'Ψηφιακή βεβαίωση εγγράφου'). Μπορείτε να πάτε απευθείας εδώ: https://www.gov.gr/ipiresies/polites-kai-kathemerinoteta/psephiaka-eggrapha-gov-gr/psephiake-bebaiose-eggraphou Πληκτρολογούμε στο Google: Ψηφιακή βεβαίωση εγγράφου, επιλέγουμε το πρώτο, ακολουθούμε τα βήματα, συνδεόμαστε, ανεβάζουμε το αρχείο στο αντίστοιχο πεδίο, επιλέγουμε υπογραφή στα ελληνικά και ολοκληρώνουμε με τον κωδικό SMS. Βγάζουμε καλή φωτογραφία το QR code και το στέλνουμε. - ΑΦΜ, ΑΜΑ, ΑΜΚΑ και μία διεύθυνση."
   ├── PDF Attachment with instructions
   ├── Optional Declaration File (Greek): "ΥΠ_ΔΗΛΩΣΗ_ΠΟΙΝΙΚΟΥ.pdf"
   ├── Final Thank You Message (EN/GR):
   │   ├── EN: "Thank you! Please come to the next step as instructed."
   │   └── GR: "Ευχαριστούμε! Παρακαλώ προχωρήστε στο επόμενο βήμα όπως σας ενημερώσαμε."
   └── Admin Notification: "🆕 Candidate ready for evaluation: [Name]"

8. Admin Evaluation (Interactive)
   ├── Admin receives message in group (-4963327393)
   ├── Should we continue? [Yes/No]
   ├── If Yes:
   │   ├── Position selection: [HL] [Supervisor] [EQ]
   │   └── Course date: [Preset dates] [📅 Custom date]
   └── If No: Rejection options

9. User Course Confirmation
   ├── User gets congratulations with position and course date
   ├── STATUS changes to "COURSE" in Registration sheet

10. Reminder Function (Day before course at 10:00 AM)
    ├── Bot sends: "Reminder: Your course is tomorrow at 9:50-15:00. Will you attend?"
    ├── Options: [Yes, I will attend] [No, I cannot attend]
    └── If user confirms "Yes" → STATUS: "WORKING" → User added to WORKERS sheet

11. Segment 1 Complete
    └── User now has STATUS: "WORKING" and is in WORKERS sheet
```

### Check-in/out Flow (Segment 2 - Working State)
```
Working User Menu
├── Check-in
│   ├── Request location
│   ├── Validate location
│   └── Record check-in time
├── Check-out
│   ├── Request location
│   ├── Validate location
│   └── Record check-out time
└── Contact Support
```

### Language-Based Flow
- **Language Selection**: User chooses EN or GR at the beginning
- **Entire Flow**: All questions, messages, buttons, and responses work in the selected language
- **Consistent Experience**: From first question to final confirmation, everything is in the user's chosen language

### Persistent Elements
- **Contact Button**: Always available below message input field (silent redirect to your DM)
- **Language Support**: EN/GR throughout all flows

## Next Steps
1. Set up basic Telegram bot structure
2. Configure webhook endpoint
3. Design Google Sheets integration
4. Implement registration workflow
5. Build check-in/out location system
6. Create admin reporting features
7. Deploy to Render.com Web Service
8. Implement contact button (pinned below message input)
