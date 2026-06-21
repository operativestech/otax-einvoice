
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

async function listCerts() {
    try {
        console.log("Listing certificates in CurrentUser My store...\n");
        // Using PowerShell to get a cleaner list
        const { stdout } = await execPromise('powershell "Get-ChildItem Cert:\\CurrentUser\\My | Select-Object Subject, Thumbprint, NotAfter | Format-List"');
        console.log(stdout);

        console.log("-----------------------------------------");
        console.log("IMPORTANT: Look for certificates issued by 'Egypt Trust' or 'Misr El Maqasa'.");
        console.log("The Thumbprint of THAT certificate should be put in your settings.");
        console.log("If you see 'localhost', that is WRONG for production/pre-prod submission.");
    } catch (err) {
        console.error("Error listing certificates:", err.message);
    }
}

listCerts();
