# Firebase setup

## 1. Authentication

1. Open Firebase Console and choose project `malinkiecodb`.
2. Open `Authentication` -> `Sign-in method`.
3. Enable `Email/Password`.
4. Open `Authentication` -> `Users`.
5. Create the admin account manually.

## 2. Firestore admin document

1. Open `Firestore Database` -> `Data`.
2. Create collection `users` if it does not exist.
3. Create a document with the admin UID from Firebase Authentication.
4. Put these fields into the document:
   - `email`
   - `fullName`
   - `plotName`
   - `role` = `ADMIN`
   - `balance` = `0`

## 3. Firestore rules

Paste these rules into `Firestore Database` -> `Rules` and publish them:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function userDoc(uid) {
      return get(/databases/$(database)/documents/users/$(uid));
    }

    function isAdmin() {
      return signedIn() &&
        exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
        userDoc(request.auth.uid).data.role == 'ADMIN';
    }

    function isModerator() {
      return signedIn() &&
        exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
        userDoc(request.auth.uid).data.role == 'MODERATOR';
    }

    function canCreateEvents() {
      return isAdmin() || isModerator();
    }

    match /users/{userId} {
      allow read: if signedIn();
      allow create: if isAdmin() ||
        (signedIn() &&
         request.auth.uid == userId &&
         request.resource.data.role in ['USER', 'MODERATOR', 'ADMIN']);
      allow update: if isAdmin();
      allow delete: if isAdmin();
    }

    match /payments/{paymentId} {
      allow read: if signedIn();
      allow create: if isAdmin() ||
        (signedIn() && request.resource.data.userId == request.auth.uid);
      allow update, delete: if false;
    }

    match /chat_messages/{messageId} {
      allow read: if signedIn();
      allow create: if signedIn() &&
        request.resource.data.senderId == request.auth.uid;
      allow update, delete: if false;
    }

    match /events/{eventId} {
      allow read: if signedIn();
      allow create: if canCreateEvents() &&
        request.resource.data.createdById == request.auth.uid;
      allow update, delete: if false;
    }
  }
}
```

## 4. Cloud Messaging

1. Open `Build` -> `Cloud Messaging`.
2. No manual topic creation is needed.
3. The Android app subscribes devices to topic `community_events` after login.

## 5. Functions for automatic push

The project now contains ready Firebase Functions code:

- `functions/index.js`
- `functions/package.json`
- `firebase.json`

This function watches Firestore collection `events` and sends an FCM push to topic `community_events`.

## 6. What you need to run locally one time

Install Firebase CLI if you do not have it:

```bash
npm install -g firebase-tools
```

Login and connect to your Firebase account:

```bash
firebase login
```

From the project root initialize the project if needed:

```bash
firebase use malinkiecodb
```

Install function dependencies:

```bash
cd functions
npm install
```

Deploy functions:

```bash
cd ..
firebase deploy --only functions
```

## 7. Notes

- Android app already contains FCM client code and a background messaging service.
- Automatic push for new events works only after Functions are deployed.
- Without deployed Functions, events still appear in real time inside the app, but system push notifications will not be sent automatically.
## Firestore Rules for Current App Version

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function userDoc(uid) {
      return get(/databases/$(database)/documents/users/$(uid));
    }

    function isAdmin() {
      return signedIn() &&
        exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
        userDoc(request.auth.uid).data.role == 'ADMIN';
    }

    function isModerator() {
      return signedIn() &&
        exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
        userDoc(request.auth.uid).data.role == 'MODERATOR';
    }

    function canCreateEvents() {
      return isAdmin() || isModerator();
    }

    match /users/{userId} {
      allow read: if signedIn();

      allow create: if isAdmin() || isModerator() ||
        (signedIn() &&
         request.auth.uid == userId &&
         request.resource.data.role in ['USER', 'MODERATOR', 'ADMIN']);

      allow update: if isAdmin() ||
        (isModerator() &&
         request.resource.data.diff(resource.data).changedKeys().hasOnly(['balance'])) ||
        (signedIn() &&
         request.auth.uid == userId &&
         request.resource.data.diff(resource.data).changedKeys().hasOnly(['lastChatReadAt']));

      allow delete: if isAdmin();
    }

    match /payments/{paymentId} {
      allow read: if signedIn();

      allow create: if isAdmin() || isModerator() ||
        (signedIn() && request.resource.data.userId == request.auth.uid);

      allow update, delete: if false;
    }

    match /payment_requests/{requestId} {
      allow read: if isAdmin() || isModerator() ||
        (signedIn() && resource.data.userId == request.auth.uid);

      allow create: if signedIn() &&
        request.resource.data.userId == request.auth.uid &&
        request.resource.data.status == 'PENDING';

      allow update: if isAdmin() || isModerator();

      allow delete: if false;
    }

    match /registration_requests/{requestId} {
      allow read: if isAdmin() || isModerator() ||
        (signedIn() && request.auth.uid == requestId);

      allow create: if signedIn() &&
        request.auth.uid == requestId &&
        request.resource.data.status == 'PENDING';

      allow update: if isAdmin() || isModerator();

      allow delete: if false;
    }

    match /app_settings/{docId} {
      allow read: if docId == 'app_gate' || signedIn();
      allow write: if isAdmin() || isModerator();
    }

    match /chat_messages/{messageId} {
      allow read: if signedIn();

      allow create: if signedIn() &&
        request.resource.data.senderId == request.auth.uid;

      allow update: if signedIn() &&
        resource.data.senderId == request.auth.uid &&
        request.resource.data.senderId == resource.data.senderId;

      allow delete: if signedIn() &&
        resource.data.senderId == request.auth.uid;
    }

    match /events/{eventId} {
      allow read: if signedIn();

      allow create: if
        (
          canCreateEvents() &&
          request.resource.data.createdById == request.auth.uid
        ) ||
        (
          signedIn() &&
          request.resource.data.createdById == request.auth.uid &&
          request.resource.data.type == 'POLL'
        );

      allow update: if
        (
          canCreateEvents() &&
          resource.data.type in ['CHARGE', 'POLL'] &&
          request.resource.data.diff(resource.data).changedKeys().hasOnly([
            'isClosed',
            'closedById',
            'closedByName',
            'closedAtClient',
            'message'
          ])
        ) ||
        (
          signedIn() &&
          resource.data.type == 'POLL' &&
          (resource.data.isClosed == false || resource.data.isClosed == null) &&
          !(request.auth.uid in resource.data.voterIds) &&
          request.auth.uid in request.resource.data.voterIds &&
          request.resource.data.diff(resource.data).changedKeys().hasOnly([
            'pollVotes',
            'voterIds',
            'voterChoices'
          ])
        );

      allow delete: if false;
    }
  }
}
```
