# 🎯 EXACT STEPS - What You Need to Do

## ✅ Code Changes Complete

I've already updated your Node.js code to use the ETA Signer Service. Now you just need to set up the Java service.

---

## What You Need From Your Side

### 1. Install Java JDK 17

**Download**: https://www.oracle.com/java/technologies/javase/jdk17-archive-downloads.html

Choose: **Windows x64 Installer**

After installation, verify:
```cmd
java -version
```

Should show: `java version "17.x.x"`

---

### 2. Clone and Build the Signer

Open Command Prompt and run:

```cmd
cd e:\E-Invoice\E-Invoice

git clone https://github.com/mostafaism1/eta-einvoice-signer

cd eta-einvoice-signer

mvnw.cmd clean package
```

**Wait for build to complete** (may take 2-3 minutes)

---

### 3. Download Apache Tomcat

**Download**: https://tomcat.apache.org/download-10.cgi

Choose: **32-bit/64-bit Windows Service Installer**

Install to: `C:\Program Files\Apache Software Foundation\Tomcat 10.1`

Or extract the ZIP version to: `e:\E-Invoice\tomcat`

---

### 4. Create Configuration Files

#### File 1: PKCS#11 Config

**Location**: `C:\Windows\System32\eps2003csp11.cfg`

**Content**:
```
name = ePass2003
library = C:\Windows\System32\eps2003csp11.dll
```

**How to create**:
```cmd
notepad C:\Windows\System32\eps2003csp11.cfg
```

Paste the content above, save and close.

---

#### File 2: Application Properties

**Location**: `e:\E-Invoice\E-Invoice\eta-einvoice-signer\target\eta-einvoice-signer\WEB-INF\classes\application.properties`

**Content**:
```properties
# Hardware Token Configuration
signature.keystore.type=hardware
signature.keystore.pkcs11ConfigFilePath=C:\\Windows\\System32\\eps2003csp11.cfg
signature.keystore.password=09761969
signature.keystore.certificateIssuerName=MCDR CA 2022

# Authentication
auth.user.userName=admin
auth.user.encryptedPassword=$2a$10$N9qo8uLOickgx2ZMRZoMye1J8xrOrObkrKKvvCzUy.UU5V3sxXqYu
```

**Note**: The password is "password" (encrypted). You can change it later.

**How to create**:
```cmd
cd e:\E-Invoice\E-Invoice\eta-einvoice-signer\target\eta-einvoice-signer\WEB-INF\classes

notepad application.properties
```

Paste the content above, save and close.

---

### 5. Deploy to Tomcat

#### Option A: If you installed Tomcat as a service

1. Copy the WAR file:
   ```cmd
   copy e:\E-Invoice\E-Invoice\eta-einvoice-signer\target\eta-einvoice-signer.war "C:\Program Files\Apache Software Foundation\Tomcat 10.1\webapps\"
   ```

2. Start Tomcat service:
   - Open Services (Win+R, type `services.msc`)
   - Find "Apache Tomcat"
   - Right-click → Start

#### Option B: If you extracted Tomcat ZIP

1. Copy the WAR file:
   ```cmd
   copy e:\E-Invoice\E-Invoice\eta-einvoice-signer\target\eta-einvoice-signer.war e:\E-Invoice\tomcat\webapps\
   ```

2. Start Tomcat:
   ```cmd
   cd e:\E-Invoice\tomcat\bin
   startup.bat
   ```

---

### 6. Test the Service

Wait 30 seconds for Tomcat to deploy, then test:

```cmd
curl -X POST http://localhost:8080/eta-einvoice-signer -u admin:password -H "Content-Type: application/json" -d "{\"documents\":[{\"issuer\":{\"type\":\"B\",\"id\":\"562067566\",\"name\":\"Test\"}}]}"
```

**Expected**: Should return JSON with a signature

**If curl doesn't work**, test in browser:
- Open: http://localhost:8080/eta-einvoice-signer
- Should prompt for username/password (admin/password)

---

### 7. Update Node.js Configuration

Edit: `e:\E-Invoice\E-Invoice\server\etaSignerIntegration.ts`

Update lines 5-6 if you changed the password:
```typescript
const SIGNER_USERNAME = 'admin';
const SIGNER_PASSWORD = 'password';  // Change if you used different password
```

---

### 8. Restart Your Server

```cmd
cd e:\E-Invoice\E-Invoice
npm run server
```

---

### 9. Submit Invoice

1. Open browser: `http://localhost:3000`
2. Import Excel or create manual invoice
3. Click Submit

**Watch server logs for**:
```
[ETA Signer Service] ✓ Response received
[ETA Signer Service] Signature size: ~5500 chars (~4125 bytes)
[ETA Signer Service] ✓ Signature size looks good
```

---

### 10. Verify Result

Check invoice XML in `invoices/` folder:

**SUCCESS**:
```xml
<status>Valid</status>
```

**NO error 4062!**
**NO error 4043!**

---

## Troubleshooting

### "mvnw.cmd not found"

**Fix**: Make sure you're in the `eta-einvoice-signer` directory

### "Port 8080 already in use"

**Fix**: Another service is using port 8080. Either:
- Stop that service
- Or change Tomcat port in `server.xml`

### "Connection refused" when testing

**Fix**: 
1. Check Tomcat is running
2. Check logs: `tomcat\logs\catalina.out` or `tomcat\logs\catalina.YYYY-MM-DD.log`

### Service returns 401 Unauthorized

**Fix**: Check username/password in the curl command or in `etaSignerIntegration.ts`

---

## Summary - What I Need From You

1. ✅ **Install Java JDK 17**
2. ✅ **Run the build commands** (git clone + mvnw)
3. ✅ **Download Tomcat**
4. ✅ **Create 2 config files** (eps2003csp11.cfg + application.properties)
5. ✅ **Deploy to Tomcat**
6. ✅ **Test the service**
7. ✅ **Restart Node.js server**
8. ✅ **Submit invoice and verify**

---

**Start with Step 1 (Install Java) and let me know when you're ready for the next step!** 🙏
