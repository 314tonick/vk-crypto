// In packet:
// version: 0.0
// key_sender:
// key_recipient:
// iv:
// ciphertext:
// signature:
function looksLikeRsaKey(keyString) {
    if (typeof(keyString) != "string") {
        return false;
    }
    if (keyString.length <= 200) {
        return false;
    }
    // if (keyString.length > 1000) {
    //     return false;
    // }
    return true;
}
function bufferToBase64(buffer) {
    return (new Uint8Array(buffer)).toBase64();
}
function base64ToBuffer(base64string) {
    return (Uint8Array.fromBase64(base64string)).buffer;
}
function stableStringify(obj) {
    if (obj === null || typeof obj !== "object") {
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        return "[" + obj.map(stableStringify).join(",") + "]";
    }
    const keys = Object.keys(obj).sort();
    return "{" + keys.map(k =>
        JSON.stringify(k) + ":" + stableStringify(obj[k])
    ).join(",") + "}";
}

function getChatId() {
    const url = document.URL;
    const reg = /[0123456789]+/;
    const results = reg.exec(url);
    if (results == null) return -1;
    for (let occ of results) {
        if (parseInt(occ) >= 100) {
            return parseInt(occ);
        }
    }
    return -1;
}
async function encrypt(text, chat_id) {
    const sender_rsa_raw = (await chrome.runtime.sendMessage({action: "get_public_rsa_key"})).result;
    const private_rsa_raw = (await chrome.runtime.sendMessage({action: "get_private_rsa_key"})).result;
    const receiver_rsa_raw = (await chrome.runtime.sendMessage({action: "get_someones_rsa_key", chatId: chat_id})).result;
    if (!looksLikeRsaKey(sender_rsa_raw) || !looksLikeRsaKey(private_rsa_raw)) {
        throw new Error("Вам требуется сгенерировать пару ключей RSA. Используйте всплывающее меню для этого");
    }
    if (!looksLikeRsaKey(receiver_rsa_raw)) {
        throw new Error("Вам нужен открытый ключ собеседника (и ему - ваш). Его можно скопировать во всплывающем окне расширения. Вставлять в окне \"Crypto\" на странице чата.");
    }
    const sender_rsa = await crypto.subtle.importKey(
        "spki",
        Uint8Array.fromBase64(sender_rsa_raw),
        {name: "RSA-OAEP", hash: "SHA-256"},
        false,
        ["encrypt"]
    );
    const receiver_rsa = await crypto.subtle.importKey(
        "spki",
        Uint8Array.fromBase64(receiver_rsa_raw),
        {name: "RSA-OAEP", hash: "SHA-256"},
        false,
        ["encrypt"]
    );
    const aes_key = await crypto.subtle.generateKey(
        {name: "AES-GCM", length: 256},
        true,
        ["encrypt", "decrypt"]
    );
    const private_rsa_to_sign = await crypto.subtle.importKey(
        "pkcs8",
        Uint8Array.fromBase64(private_rsa_raw),
        {name: "RSA-PSS", hash: "SHA-256"},
        false,
        ["sign"]
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await crypto.subtle.encrypt(
        {name: "AES-GCM", iv: iv},
        aes_key,
        new TextEncoder().encode(text)
    );

    const raw_aes = await crypto.subtle.exportKey(
        "raw",
        aes_key
    );

    const key_recipient = await crypto.subtle.encrypt(
        {name: "RSA-OAEP"},
        receiver_rsa,
        raw_aes
    );
    const key_sender = await crypto.subtle.encrypt(
        {name: "RSA-OAEP"},
        sender_rsa,
        raw_aes
    );
    let packet = {
        version: "0.0",
        key_sender: bufferToBase64(key_sender),
        key_recipient: bufferToBase64(key_recipient),
        iv: bufferToBase64(iv.buffer),
        ciphertext: bufferToBase64(ciphertext),
    };
    const signature = await crypto.subtle.sign(
        {name: "RSA-PSS", saltLength: 32},
        private_rsa_to_sign,
        new TextEncoder().encode(stableStringify(packet))
    );
    packet["signature"] = bufferToBase64(signature);
    return packet;
}
async function decrypt(packet, chat_id) {
    const sender_rsa_raw_all = (await chrome.runtime.sendMessage({action: "get_public_rsa_key"})).all;
    const private_rsa_raw_all = (await chrome.runtime.sendMessage({action: "get_private_rsa_key"})).all;
    const receiver_rsa_raw_all = (await chrome.runtime.sendMessage({action: "get_someones_rsa_key", chatId: chat_id})).all;
    if (!receiver_rsa_raw_all) {
        throw new Error("Unknown chatId: " + chat_id);
    }
    let rsa_priv_keys = [];
    for (let i = 0; i < private_rsa_raw_all.length; ++i) {
        try {
           const private_rsa = await crypto.subtle.importKey(
                "pkcs8",
                Uint8Array.fromBase64(private_rsa_raw_all[i]),
                {name: "RSA-OAEP", hash: "SHA-256"},
                false,
                ["decrypt"]
            );
            rsa_priv_keys.push(private_rsa);
        } catch (error) {} // Wrong key, skipping.
    }
    let attempts = [];
    for (let sender_rsa_raw of sender_rsa_raw_all) {
        try {
            const sender_rsa_to_verify = await crypto.subtle.importKey(
                "spki",
                Uint8Array.fromBase64(sender_rsa_raw),
                {name: "RSA-PSS", hash: "SHA-256"},
                false,
                ["verify"]
            );
            attempts.push({rsaPssKey: sender_rsa_to_verify, encryptedAes: packet.key_sender, rsaOaepKeys: rsa_priv_keys});
        } catch (error) {} // Wrong key, skipping.
    }
    console.log(attempts);
    for (let receiver_rsa_raw of receiver_rsa_raw_all) {
        try {
            const receiver_rsa_to_verify = await crypto.subtle.importKey(
                "spki",
                Uint8Array.fromBase64(receiver_rsa_raw),
                {name: "RSA-PSS", hash: "SHA-256"},
                false,
                ["verify"]
            );
            attempts.push({rsaPssKey: receiver_rsa_to_verify, encryptedAes: packet.key_recipient, rsaOaepKeys: rsa_priv_keys});
        } catch (error) {} // Wrong key, skipping
    }

    let aes_key_raw = undefined;

    let packet_no_signature = structuredClone(packet);
    delete packet_no_signature.signature;
    let hash_of_no_signature = new TextEncoder().encode(stableStringify(packet_no_signature));
    for (let attempt of attempts) {
        const verify_result = await crypto.subtle.verify(
            {name: "RSA-PSS", saltLength: 32},
            attempt.rsaPssKey,
            base64ToBuffer(packet.signature),
            hash_of_no_signature
        );
        if (verify_result) {
            for (let rsaOaepKey of attempt.rsaOaepKeys) {
                console.log("trying");
                try {
                    aes_key_raw = await crypto.subtle.decrypt(
                        {name: "RSA-OAEP"},
                        rsaOaepKey,
                        base64ToBuffer(attempt.encryptedAes)
                    );
                    break;
                } catch (error) {} // From priv key.
            }
            break;
        }
    }
    if (aes_key_raw == undefined) {
        throw new Error("Не удалось расшифровать сообщение. Не найдено подходящего ключа / подпись не подходит.");
    }
    const aes_key = await crypto.subtle.importKey(
        "raw",
        aes_key_raw,
        {name: "AES-GCM", length: 256},
        false,
        ["decrypt"]
    );
    const decrypted_buffer = await crypto.subtle.decrypt(
        {name: "AES-GCM", length: 256, iv: base64ToBuffer(packet.iv)},
        aes_key,
        base64ToBuffer(packet.ciphertext)
    );
    return new TextDecoder().decode(decrypted_buffer);
}
function packet_to_text(packet) {
    return JSON.stringify(packet);
}
function text_to_packet(text) {
    let packet = {};
    try {
        packet = JSON.parse(text);
        if (typeof(packet) != "object") throw new SyntaxError();
    } catch (err) {
        throw new Error("Формат пакета нарушен. Скорее всего, сообщение просто напросто отправлено без шифрования");
    }
    let fields = ["version", "key_sender", "key_recipient", "iv", "ciphertext", "signature"];
    for (let field of fields) {
        if (!(field in packet)) {
            throw new Error("В пакете отсутствует поле: " + field + ". Возможно пакет с более старой / новой версии.");
        }
    }
    return packet;
}

async function send() {
    console.log("sending");
    const inputs = document.getElementsByClassName("ConvoComposer__input ComposerInput__input--fixed");
    if (inputs.length > 1) {
        alert("Ошибка: более 1 элемента, который я думал поле ввода.")
        return;
    }
    if (inputs.length == 0) {
        alert("Ошибка: не найдено поле ввода.");
        return;
    }
    let input = inputs[0];

    let text = "";
    for (let nd of input.childNodes) {
        if (nd.tagName == undefined) {
            text += nd.textContent;
        } else if (nd.tagName == "IMG") {
            text += nd.alt;
        }
    }

    if (!text.trim()) return;

    const chat_id = getChatId();
    if (chat_id == -1) {
        alert("Ошибка! Не удалось определить id чата.");
        return;
    }

    try {
        const encrypted = packet_to_text(await encrypt(text, chat_id));
        if (encrypted.length > 4096) {
            alert("Ошибка! Сообщение слишком длинное. Пока что длинные сообщения не поддерживаются. Разбейте на части.");
            return;
        }

        console.log(encrypted);
        input.textContent = encrypted;

        let send_buttons = document.getElementsByClassName("ConvoComposer__sendButton--submit");
        if (send_buttons.length != 1) {
            alert("Ошибка. Не одна кнопка отправки.");
            return;
        }
        let send_button = send_buttons[0];
        send_button.click();
    } catch (err) {
        alert("Ошибка отправки сообщения: " + err.message);
    }
}

async function non_decrypted_watcher() {
    try {
        let nodes = document.getElementsByClassName("MessageText");
        const chat_id = getChatId();
        if (chat_id == -1) {
            return;
        }
        for (let node of nodes) {
            if (node.classList.contains("decrypted")) {
                continue;
            }
            node.classList.add("decrypted");
            try {
                node.textContent = await decrypt(text_to_packet(node.textContent), chat_id);
                let check_mark_nd = document.createElement("img");
                check_mark_nd.alt = "✔";
                check_mark_nd.src = chrome.runtime.getURL("resources/encrypted_sign.png");
                check_mark_nd.classList.add("vk-crypto-verified");
                check_mark_nd.title = "Сообщение было отправлено и расшифровано. Сертификат проверен.";
                node.append(check_mark_nd);
            } catch (error) {
                console.log(error);
                node.title = error.message;
            }
        }
    } catch (e) {
        throw e;
    } finally {
        setTimeout(non_decrypted_watcher, 30);
    }
}

async function add_stylesheet() {
    const style = document.createElement("style");
    style.id = "vk-crypto-stylesheet";
    style.textContent = `
        .vk-crypto-mini-btn {
        // position: fixed;
        //bottom: 20px;
        //right: 20px;
        z-index: 999999;
        background: rgb(10, 10, 53);
        color: rgb(255, 233, 188);
        border: none;
        padding: 10px 14px;
        border-radius: 10px;
        cursor: pointer;
        font-size: 15px;
        font-family: 'Franklin Gothic Medium', 'Arial Narrow', Arial, sans-serif;
        }

        .vk-crypto-popup {
        position: fixed;
        transform: translateY(45px);
        transition: transform 0.15s ease;
        // bottom: 70px;
        //right: 20px;
        width: 260px;
        background: rgb(22, 22, 70);
        color: rgb(255, 233, 188);
        padding: 12px;
        border-radius: 12px;
        z-index: 999999;
        display: none;
        box-shadow: 0 10px 30px rgba(0,0,0,0.4);
        }

        .vk-crypto-popup input {
        width: 100%;
        margin-top: 6px;
        margin-bottom: 10px;
        padding: 8px;
        border-radius: 8px;
        border: none;
        outline: none;
        background: rgb(35, 35, 100);
        color: rgb(255, 233, 188);
        }

        .vk-crypto-popup button {
        width: 100%;
        padding: 8px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        background: rgb(10, 10, 53);
        color: rgb(255, 233, 188);
        font-family: 'Franklin Gothic Medium', 'Arial Narrow', Arial, sans-serif;
        }

        .vk-crypto-popup-title {
        font-size: 22px;
        margin-bottom: 6px;
        opacity: 0.9;
        font-family: 'Franklin Gothic Medium', 'Arial Narrow', Arial, sans-serif;
        }

        .vk-crypto-popup-label {
        font-size: 17px;
        margin-bottom: 6px;
        opacity: 0.9;
        font-family: 'Franklin Gothic Medium', 'Arial Narrow', Arial, sans-serif;
        }

        .vk-crypto-verified {
        font-size: 10px;
        // background-color: rgb(45, 226, 129);
        color: rgb(255, 255, 255);
        width: 1.4em;
        height: 1.4em;
        margin-left: 5px;
        vertical-align: middle
        }

        .vk-crypto-send-button {
        font-size: 10px;
        // background-color: rgb(45, 226, 129);
        color: rgb(255, 255, 255);
        width: 1.4em;
        height: 1.4em;
        margin-left: 5px;
        margin-right: 5px;
        vertical-align: middle
        }
    `;
    document.head.appendChild(style);
}

async function add_crypto_page() {
    let ins_after = document.getElementsByClassName("ConvoHeader__controls")[0];
    if (ins_after != undefined) {
        // ====== КНОПКА ======
        const btn = document.createElement("button");
        btn.id = "vk-crypto-page-button";
        btn.className = "vk-crypto-mini-btn";
        btn.innerText = "Crypto";

        // ====== POPUP ======
        const popup = document.createElement("div");
        popup.className = "vk-crypto-popup";

        popup.innerHTML = `
            <div class="vk-crypto-popup-title">Chat ID: <span id="chat-id-text">—id-</span></div>

            <div class="vk-crypto-popup-label">RSA-ключ:</div>
            <input id="key-input" type="text" placeholder="Введите строку..." />

            <div class="vk-crypto-popup-label" id="vk-crypto-no-key-error-label" style="color: red; font-size: 13px; display: none">Сейчас ключ не введен или он даже не похож на ключ. Чтобы отправлять защищенные сообщения, он необходим. Получите его у собеседника через надежный источник</div>

            <button id="update-btn">Обновить ключ</button>
        `;

        ins_after.prepend(btn);
        ins_after.prepend(popup);

        const value = document.getElementById("key-input");
        const chatIdNd = document.getElementById("chat-id-text");
        const error_no_rsa_label = document.getElementById("vk-crypto-no-key-error-label");

        let open = false;

        btn.addEventListener("click", async () => {
            open = !open;
            popup.style.display = open ? "block" : "none";
            // popup.style.transform = open ? "translateY(50px)" : "translateY(0px)";
            popup.style.transform = "";
            const rect = popup.getBoundingClientRect();
            const overflowRight = rect.right - window.innerWidth;

            if (overflowRight > 0) {
                popup.style.transform = `translateX(-${overflowRight + 10}px) translateY(50px)`;
            } else {
                popup.style.transform = "translateY(50px)";
            }


            const chatId = getChatId();
            chatIdNd.innerText = chatId;

            const curKey = (await chrome.runtime.sendMessage({action: "get_someones_rsa_key", chatId: chatId})).result;
            if (curKey == undefined) {
                error_no_rsa_label.style.display = "block";
            } else if (curKey.length < 200) {
                error_no_rsa_label.style.display = "block";
                value.value = curKey;
            } else {
                error_no_rsa_label.style.display = "none";
                value.value = curKey;
            }
        });

        popup.querySelector("#update-btn").addEventListener("click", async () => {
            const key = value.value;
            const chatId = getChatId();
            if (key.length < 200) {
                alert("Это не похоже на нужный ключ. Корректный состоит из примерно 350 печатаемых ASCII символов.");
                return;
            }
            await chrome.runtime.sendMessage({action: "add_someones_rsa_key", value: key, chatId: chatId});
            error_no_rsa_label.style.display = "none";
            value.value = key;
        });
    }
}

async function add_send_encrypted_button() {
    let all_bottom_buttons = document.getElementsByClassName("ConvoComposer__button");
    let nd = all_bottom_buttons[all_bottom_buttons.length - 1];
    if (nd != undefined) {
        let btn = document.createElement("button");
        btn.id = "vk-crypto-send-button";
        btn.classList.add("ConvoComposer__button");
        let img = document.createElement("img");
        // img.classList.add("vk-crypto-send-button");
        img.src = chrome.runtime.getURL("resources/send_button.png");
        btn.onclick = send;
        btn.title = "Отправить с шифрованием";
        img.alt = "🔒";
        img.style.width = img.style.height = "28px";
        btn.appendChild(img);
        nd.after(btn);
    }
}
async function move_send_encrypted_button_to_right_place() {
    let all_bottom_buttons = document.getElementsByClassName("ConvoComposer__button");
    let btn = document.getElementById("vk-crypto-send-button");
    let nd = all_bottom_buttons[all_bottom_buttons.length - 1];
    if (btn != nd) {
        nd.after(btn);
    }
}

async function try_add_custom_things() {
    if (document.getElementById("vk-crypto-stylesheet") == null) {
        try {add_stylesheet();} catch (e) {console.log("Adding stylesheet failed: " + e.message);}
    }
    if (document.getElementById("vk-crypto-page-button") == null) {
        try {add_crypto_page();} catch (e) {console.log("Adding crypto page failed: " + e.message);}
    }
    if (document.getElementById("vk-crypto-send-button") == null) {
        try {add_send_encrypted_button();} catch (e) {console.log("Adding crypto send button failed: " + e.message);}
    } else {
        try {move_send_encrypted_button_to_right_place();} catch (e) {console.log("Moving crypto send button failed: " + e.message);}
    }
    setTimeout(try_add_custom_things, 10);
}

window.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.altKey) {
        e.preventDefault();
        e.stopPropagation();

        send();
    }
}, true);
non_decrypted_watcher();
setTimeout(try_add_custom_things, 10);
console.log("loaded");
