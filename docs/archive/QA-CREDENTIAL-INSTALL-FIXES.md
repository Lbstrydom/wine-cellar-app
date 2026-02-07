# QA Test Plan: Credential Isolation + PWA Install UX

**Deployment**: Railway auto-deploy from commit `c045a1d`
**Date**: February 6, 2026
**Fixes**: Multi-user credential isolation + PWA install UX improvements

---

## 🚀 Pre-Test Setup

1. **Wait for Railway deployment** (~2-3 minutes)
   - Check build logs: https://railway.app/project/wine-cellar-app
   - Or wait for deployment notification

2. **Prepare test devices**:
   - Device A: Your primary device (desktop/mobile)
   - Device B: Secondary device (or incognito window)
   - Both must be logged into **same cellar** for sync tests

3. **Clear browser cache** (force fresh CSS/JS):
   - Chrome: Ctrl+Shift+Delete → Clear cache
   - Or hard refresh: Ctrl+Shift+R (Cmd+Shift+R on Mac)

---

## 🔐 Test 1: Credential Storage & Encryption

**Purpose**: Verify credentials are saved with AES-256-GCM encryption

### Steps:
1. Open https://cellar.creathyst.com
2. Navigate to **Settings** → **Source Credentials**
3. Find **Vivino** section
4. Enter test credentials:
   - Username: `test_user_vivino`
   - Password: `test_password_123`
5. Click **Save**

### ✅ Expected Results:
- Toast notification: "Credentials saved"
- Status changes to "Configured"
- Username shows in read-only field

### ❌ Fail If:
- Error message appears
- Credentials not saved after refresh
- Username not displayed

---

## 🔄 Test 2: Cross-Device Sync (Same Cellar)

**Purpose**: Verify credentials sync across devices within same cellar

### Steps:
1. **On Device A**: Save Vivino credentials (from Test 1)
2. **On Device B**:
   - Open https://cellar.creathyst.com
   - Log in with **same user account**
   - Ensure **same cellar** is active (check header)
   - Navigate to Settings → Source Credentials
   - Check Vivino section

### ✅ Expected Results:
- Status shows "Configured" (not "Not configured")
- Username shows: `test_user_vivino`
- Can edit/update credentials on Device B
- Changes sync back to Device A

### ❌ Fail If:
- Device B shows "Not configured"
- Username not visible
- Changes don't sync between devices

---

## 🔒 Test 3: Cellar Isolation (Security Critical)

**Purpose**: Verify credentials are NOT visible across different cellars

### Steps:
1. **On Device A**: Save Vivino credentials in Cellar A
2. **Switch to Cellar B**:
   - Click cellar name in header → Select different cellar
   - Or use cellar switcher dropdown
3. Navigate to Settings → Source Credentials
4. Check Vivino section

### ✅ Expected Results:
- Status shows "Not configured" (credentials hidden)
- Username field empty
- Cellar B cannot see Cellar A's credentials

### ❌ Fail If (SECURITY ISSUE):
- Cellar B shows Cellar A's credentials
- Username visible across cellars
- Any cross-cellar leakage

---

## 🔐 Test 4: Decanter Credentials

**Purpose**: Verify Decanter credentials work same as Vivino

### Steps:
1. Navigate to Settings → Source Credentials
2. Find **Decanter** section
3. Enter test credentials:
   - Username: `test_user_decanter`
   - Password: `test_password_456`
4. Click **Save**
5. Verify sync on Device B (same cellar)
6. Verify isolation in different cellar

### ✅ Expected Results:
- Same behavior as Vivino tests
- Both Vivino AND Decanter credentials persist independently
- No interference between sources

### ❌ Fail If:
- Saving Decanter overwrites Vivino
- Cross-source credential leakage

---

## 📱 Test 5: PWA Install - Desktop Chrome/Edge

**Purpose**: Verify install button works on Chrome/Edge desktop

### Prerequisites:
- Use Chrome or Edge browser
- App must NOT already be installed
- Clear site data if needed: DevTools → Application → Clear storage

### Steps:
1. Open https://cellar.creathyst.com
2. Navigate to **Settings**
3. Scroll to **Install App** section

### ✅ Expected Results:
- Section is **visible** (not hidden)
- Shows install button: "📲 Install Wine Cellar"
- Status message: "Click the button above to install"
- Click button → Browser shows native install prompt
- After accepting → Status changes to "✅ App is installed and running in standalone mode"

### ❌ Fail If:
- Install section hidden
- Button missing
- Click does nothing
- No browser prompt appears

---

## 📱 Test 6: PWA Install - iOS Safari

**Purpose**: Verify manual install instructions on iOS

### Prerequisites:
- Use iPhone/iPad Safari browser
- Or desktop Safari (won't show install button)

### Steps:
1. Open https://cellar.creathyst.com in Safari
2. Navigate to Settings → Install App section

### ✅ Expected Results:
- Section is **visible**
- Install button is **hidden** (Safari doesn't support beforeinstallprompt)
- Shows iOS instructions:
  ```
  📱 iOS/Safari: Tap the Share button ⎙, then select "Add to Home Screen".
  ```
- Icon ⎙ visible in instructions

### ❌ Fail If:
- Section hidden
- No instructions shown
- Generic instructions (should be iOS-specific)

---

## 📱 Test 7: PWA Install - Already Installed

**Purpose**: Verify status message when app already installed

### Prerequisites:
- Install the PWA first (from Test 5)
- Launch app from home screen/app launcher

### Steps:
1. Open PWA in standalone mode (from home screen)
2. Navigate to Settings → Install App section

### ✅ Expected Results:
- Section visible
- Install button **hidden**
- Status shows: "✅ App is installed and running in standalone mode"
- Green checkmark visible

### ❌ Fail If:
- Still shows install button
- Generic message instead of "installed" status
- Section hidden

---

## 📱 Test 8: PWA Install - Mobile Chrome (Android)

**Purpose**: Verify install button works on Android Chrome

### Prerequisites:
- Android device with Chrome browser
- App not already installed

### Steps:
1. Open https://cellar.creathyst.com in Chrome
2. Navigate to Settings → Install App

### ✅ Expected Results:
- Install button visible: "📲 Install Wine Cellar"
- Status: "Click the button above to install"
- Click button → Chrome shows native install prompt
- After install → Can launch from home screen

### ❌ Fail If:
- Shows iOS-specific instructions
- No install button
- Button doesn't trigger prompt

---

## 🔄 Test 9: Credential Update/Delete

**Purpose**: Verify credential updates and deletions work

### Steps:
1. Navigate to Settings → Source Credentials (Vivino)
2. **Update**: Change password to `new_password_789`
3. Click **Save**
4. Refresh page → Verify new password saved
5. Check Device B → Should see update
6. **Delete**: Clear both username and password fields
7. Click **Save**

### ✅ Expected Results:
- Updates sync across devices
- After deletion, status shows "Not configured"
- Can re-add credentials later

### ❌ Fail If:
- Updates don't persist
- Deletion fails
- Old credentials reappear

---

## 🧪 Test 10: Regression - Phase 6 Mobile UI

**Purpose**: Ensure credential fixes didn't break Phase 6 mobile improvements

### Steps:
1. Open DevTools → Toggle device toolbar (Ctrl+Shift+M)
2. Select iPhone SE (375px width)
3. Test all views:
   - Wine list grid
   - Settings page
   - Pairing AI Sommelier
   - Cellar grid view

### ✅ Expected Results:
- All Phase 6 improvements intact:
  - Responsive breakpoints working (768px, 480px, 360px)
  - Touch targets ≥44px (tap buttons easily)
  - Text inputs 16px font size (no zoom on iOS)
  - Safe area padding on notched devices
  - Mobile navigation menu working

### ❌ Fail If:
- Layout broken
- Touch targets too small
- Inputs cause zoom on mobile

---

## 📊 Test Summary Checklist

Copy this to track your progress:

```
Credential Tests:
[ ] Test 1: Credential storage & encryption
[ ] Test 2: Cross-device sync (same cellar)
[ ] Test 3: Cellar isolation (SECURITY CRITICAL)
[ ] Test 4: Decanter credentials
[ ] Test 9: Update/delete credentials

PWA Install Tests:
[ ] Test 5: Desktop Chrome/Edge install button
[ ] Test 6: iOS Safari manual instructions
[ ] Test 7: Already installed status
[ ] Test 8: Android Chrome install

Regression Tests:
[ ] Test 10: Phase 6 mobile UI intact
```

---

## 🐛 Bug Reporting Template

If you find issues, report with:

```
**Test Failed**: Test X - [Test Name]
**Browser**: Chrome 131 / Safari iOS 17 / etc.
**Device**: Desktop / iPhone SE / etc.
**Steps**: 
1. ...
2. ...

**Expected**: ...
**Actual**: ...

**Screenshots**: (attach)
**Console Errors**: (F12 → Console tab)
```

---

## ✅ Success Criteria

All tests must pass for deployment approval:

**Critical (Must Pass)**:
- ✅ Test 3: Cellar isolation (security)
- ✅ Test 1: Credentials save correctly
- ✅ Test 2: Cross-device sync works

**High Priority**:
- ✅ Test 5: Desktop PWA install works
- ✅ Test 6: iOS manual instructions shown
- ✅ Test 9: Update/delete credentials

**Nice to Have**:
- ✅ Test 7: Already installed detection
- ✅ Test 8: Android install
- ✅ Test 10: No regressions

---

## 🔧 Troubleshooting

### "Credentials not syncing"
- Check both devices logged into **same cellar** (check cellar ID in header)
- Hard refresh browser (Ctrl+Shift+R)
- Check Network tab for 401/403 errors

### "Install button missing"
- Clear browser cache completely
- Check service worker registered: DevTools → Application → Service Workers
- Verify cache version: Should be `v89`

### "Console errors"
- F12 → Console tab
- Look for red errors mentioning "credentials" or "install"
- Copy full error message for bug report

---

## 📞 Support

If critical bugs found:
1. Stop testing immediately
2. Document with screenshots
3. Check Railway logs: `railway logs --tail 100`
4. Report findings

Railway logs: https://railway.app/project/wine-cellar-app/logs
