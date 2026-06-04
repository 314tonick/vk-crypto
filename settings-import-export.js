const popupDialogs_checkbox = document.getElementById("popupDialogs_checkbox");

let showDialogs = false;
chrome.runtime.sendMessage({action: "get_settings"})
    .then(response => {
        console.log(response);
        showDialogs = response.popupDialogs;
    },
);

function bufferToBase64(buffer) {
    return (new Uint8Array(buffer)).toBase64();
}
function base64ToBuffer(base64string) {
    return (Uint8Array.fromBase64(base64string)).buffer;
}

function alert_there(msg) {
    console.log("Alert: " + msg);
    try {if (showDialogs) {
        alert(msg);
    }} catch(err) {}
}

function prompt_there(msg, dflt) {
    if (showDialogs) {
        try {return prompt(msg, dflt);} catch(err) {return "";}
    }
    console.log("Error. Need some text but dialogs are turned off.");
    return "";
}

function confirm_there(msg) {
    console.log("confirm?", showDialogs);
    if (showDialogs) {
        try {return confirm(msg);} catch(err) {return true;}
    }
    return true;
}

async function protect_export_with_password(data, pwd) {
    if (pwd == "") {
        throw new Error("Password is empty.");
    }
    if ("passwordParameters" in data) {
        throw new Error("Savefile contains \"passwordParameters\"");
    }
    let pwdKey = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(pwd),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    let pwdThings = {
        salt: crypto.getRandomValues(new Uint8Array(16)),
        iv: crypto.getRandomValues(new Uint8Array(12)),
        iterations: 1000000
    };
    let aesKey = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: pwdThings.salt,
            iterations: pwdThings.iterations,
            hash: "SHA-256"
        },
        pwdKey,
        {
            name: "AES-GCM",
            length: 256,
            iv: pwdThings.iv
        },
        false,
        ["encrypt"]
    );
    if (data["privateRsaKey"]) {
        for (let i = 0; i < data["privateRsaKey"].length; ++i) {
            let rawRsaKey = base64ToBuffer(data["privateRsaKey"][i]);
            let protectedRsaKey = await crypto.subtle.encrypt(
                {
                    name: "AES-GCM",
                    length: 256,
                    iv: pwdThings.iv
                },
                aesKey,
                rawRsaKey
            );
            data["privateRsaKey"][i] = bufferToBase64(protectedRsaKey);
        }
    }
    pwdThings.iv = bufferToBase64(pwdThings.iv);
    pwdThings.salt = bufferToBase64(pwdThings.salt);
    data["passwordParameters"] = pwdThings;
    return data;
}

async function decrypt_export_file(data, pwd) {
    if (!("passwordParameters" in data)) {
        return data;
    }
    if (pwd == "") {
        throw new Error("Password is empty.");
    }
    let pwdKey = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(pwd),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    let pwdThings = data["passwordParameters"];
    pwdThings.iv = base64ToBuffer(pwdThings.iv);
    pwdThings.salt = base64ToBuffer(pwdThings.salt);

    let aesKey = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: pwdThings.salt,
            iterations: pwdThings.iterations,
            hash: "SHA-256"
        },
        pwdKey,
        {
            name: "AES-GCM",
            length: 256,
            iv: pwdThings.iv
        },
        false,
        ["decrypt"]
    );
    if (data["privateRsaKey"]) {
        for (let i = 0; i < data["privateRsaKey"].length; ++i) {
            let rawRsaKey = base64ToBuffer(data["privateRsaKey"][i]);
            try {
                let regularRsaKey = await crypto.subtle.decrypt(
                    {
                        name: "AES-GCM",
                        length: 256,
                        iv: pwdThings.iv
                    },
                    aesKey,
                    rawRsaKey
                );
                data["privateRsaKey"][i] = bufferToBase64(regularRsaKey);
            } catch (err) {
                throw new Error("Wrong password");
            }
        }
    }
    delete data["passwordParameters"];
    return data;
}

const export_button = document.getElementById("export_button");
const export_password_input = document.getElementById("export_password");
export_button.onclick = async () => {
    if (!confirm_there("Вы уверены, что хотите выгрузить все данные? Если пароль не вееден, ваш ключ никак не защищен.")) {
        return;
    }
    let data = await chrome.runtime.sendMessage({action: "get_all_data"});
    if (export_password_input.value != "") {
        let pwd = export_password_input.value;
        data = await protect_export_with_password(data, pwd);
    }
    let blb = new Blob([JSON.stringify(data, null, 4)], {type: "text/plain"});
    let fake_link = document.createElement("a");
    fake_link.href = URL.createObjectURL(blb);
    fake_link.download = "vk-crypto-export.json";
    fake_link.click();
    URL.revokeObjectURL(fake_link.href);
    fake_link.remove();
}

const import_button = document.getElementById("import_button");
const import_password_input = document.getElementById("import_password");
import_button.onclick = async () => {
    let fake_input = document.createElement("input");
    fake_input.type = "file";
    fake_input.accept = ".json";
    fake_input.addEventListener("change", () => {
        let file = fake_input.files[0];
        if (!file) return;
        let reader = new FileReader();
        reader.onload = async () => {
            let data_string = reader.result;
            fake_input.remove();
            if (!confirm_there("Вы уверены что хотите загрузить новые данные? Старые данные будут удалены (merge будет добавлен скоро). Это действие нельзя отменить.")) {return;}
            try {
                let data_object = JSON.parse(data_string);
                if ("passwordParameters" in data_object) {
                    data_object = await decrypt_export_file(data_object, import_password_input.value);
                }
                await chrome.runtime.sendMessage({action: "set_all_data", data: data_object});
                alert_there("Данные успешно загружены.");
                location.reload();
            } catch (err) {
                console.log(err.message == "Wrong password");
                if (err.message == "Wrong password") {
                    alert_there("Ошибка. Неверный пароль.");
                } else if (err.message == "Password is empty") {
                    alert_there("Файл зашиффрован, введите пароль в поле ввода.");
                } else {
                    alert_there("Ошибка. Формат сейва нарушен.");
                }
            }
        };
        reader.readAsText(file);
    });
    fake_input.click();
}
