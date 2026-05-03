async function generateKeys() {
    const rsaKey = await crypto.subtle.generateKey(
        {
            name: "RSA-OAEP",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1,0,1]),
            hash: "SHA-256"
        },
        true,
        ["encrypt", "decrypt"]
    );
    console.log("Keys generated:");

    const exportedPub = (new Uint8Array(await crypto.subtle.exportKey(
        "spki",
        rsaKey.publicKey
    ))).toBase64();
    const exportedPriv = (new Uint8Array(await crypto.subtle.exportKey(
        "pkcs8",
        rsaKey.privateKey
    ))).toBase64();
    
    console.log(exportedPub);

    await chrome.runtime.sendMessage({action: "set",
        data: {publicRsaKey: exportedPub}
    });
    await chrome.runtime.sendMessage({action: "set",
        data: {privateRsaKey: exportedPriv}
    });

    // alert("Сгенерированы!");
}
{
    const generate_keys_button = document.getElementById("generate_keys_button");
    if (generate_keys_button != null) {
        generate_keys_button.onclick = async () => {
            await generateKeys();
            location.reload();
        };
        // generate_keys_button.onclick = generateKeys;
    }
}