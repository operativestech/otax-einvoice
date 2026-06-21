# ✅ ETA Signer Service Setup Guide

## What This Is

A **Java web service** that runs as an HTTP API and signs e-invoices using your hardware token. Much better than a command-line tool!

---

## Setup Steps

### Step 1: Install Java

Download and install **JDK 17**:
https://www.oracle.com/java/technologies/javase/jdk17-archive-downloads.html

Verify installation:
```cmd
java -version
```

Should show: `java version "17.x.x"`

### Step 2: Clone and Build

```cmd
cd E:\E-Invoice

git clone https://github.com/mostafaism1/eta-einvoice-signer
cd eta-einvoice-signer

# Build (Windows)
mvnw.cmd clean package
```

This creates: `target/eta-einvoice-signer.war`

### Step 3: Configure

Create `application.properties` file:

**Location**: `target/eta-einvoice-signer/WEB-INF/classes/application.properties`

**Content**:
```properties
# Hardware Token Configuration
signature.keystore.type=hardware
signature.keystore.pkcs11ConfigFilePath=C:\\Windows\\System32\\eps2003csp11.cfg
signature.keystore.password=09761969
signature.keystore.certificateIssuerName=MCDR CA 2022

# Authentication (update these!)
auth.user.userName=admin
auth.user.encryptedPassword=$2a$10$N9qo8uLOickgx2ZMRZoMye1J8xrOrObkrKKvvCzUy.UU5V3sxXqYu
```

**Note**: The encrypted password above is for "password". Generate your own at: https://bcrypt.online/

### Step 4: Create PKCS#11 Config File

**File**: `C:\Windows\System32\eps2003csp11.cfg`

**Content**:
```
name = ePass2003
library = C:\Windows\System32\eps2003csp11.dll
```

### Step 5: Deploy to Tomcat

1. Download Apache Tomcat 10: https://tomcat.apache.org/download-10.cgi
2. Extract to `E:\E-Invoice\tomcat`
3. Copy `target/eta-einvoice-signer.war` to `E:\E-Invoice\tomcat\webapps\`
4. Start Tomcat:
   ```cmd
   cd E:\E-Invoice\tomcat\bin
   startup.bat
   ```

### Step 6: Test the Service

```cmd
curl -X POST http://localhost:8080/eta-einvoice-signer ^
  -u admin:password ^
  -H "Content-Type: application/json" ^
  -d "{\"documents\":[{\"issuer\":{\"type\":\"B\",\"id\":\"562067566\",\"name\":\"Test\"}}]}"
```

**Expected**: Should return signed document with signature

### Step 7: Update Node.js Integration

Edit `server/etaSignerIntegration.ts`:

```typescript
const SIGNER_URL = 'http://localhost:8080/eta-einvoice-signer';
const SIGNER_USERNAME = 'admin';  // Your username
const SIGNER_PASSWORD = 'password';  // Your password
```

### Step 8: Restart Your Server

```cmd
cd e:\E-Invoice\E-Invoice
npm run server
```

### Step 9: Submit Invoice

1. Open browser: `http://localhost:3000`
2. Submit invoice
3. Check logs for:
   ```
   [ETA Signer Service] ✓ Response received
   [ETA Signer Service] Signature size: ~5500 chars (~4125 bytes)
   [ETA Signer Service] ✓ Signature size looks good
   ```

---

## Advantages of This Approach

✅ **HTTP API** - Easy to integrate  
✅ **Java-based** - Proven PKCS#11 support  
✅ **Hardware token** - Direct access  
✅ **Stateless** - No file I/O needed  
✅ **Reusable** - Can be used by multiple apps  

---

## Troubleshooting

### "Connection refused"

**Fix**: Make sure Tomcat is running:
```cmd
cd E:\E-Invoice\tomcat\bin
startup.bat
```

### "Certificate not found"

**Fix**: Update `signature.keystore.certificateIssuerName` in `application.properties` to match your certificate issuer

### "PKCS#11 library not found"

**Fix**: Update the library path in `eps2003csp11.cfg` to point to your actual DLL location

### Service returns error

**Check Tomcat logs**: `E:\E-Invoice\tomcat\logs\catalina.out`

---

## Quick Start (If You Don't Want to Build)

The repository has a **Releases** section. Check if there's a pre-built WAR file you can download directly:

https://github.com/mostafaism1/eta-einvoice-signer/releases

---

**This is the cleanest solution - a proper REST API for signing!** 🎉
