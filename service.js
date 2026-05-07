const FIELDS = {
    field1: true
};

// Storage 0.0:
// publicRsaKey: string
// privateRsaKey: string
// pubRsa_<any_user_id>: string
// field1: boolean

// Storage 0.2:
// storageVersion: 0.2
// publicRsaKey: Array[string]
// privateRsaKey: Array[string]
// pubRsa_<any_user_id>: Array[string]
// field1: boolean

function getKeyArray(key, sendResponse) {
    chrome.storage.local.get(key).then(result => {
        let last_key = undefined;
        let real_result = result[key];
        if (Array.isArray(real_result)) {
            if (real_result.length == 0) {
                real_result = undefined;
            } else {
                last_key = real_result[real_result.length - 1];
            }
        }
        console.log("Res", real_result);
        console.log("Res", last_key);
        sendResponse({result: last_key, all: real_result});
    });
}

async function check_migration() {
    let prev_version = (await chrome.storage.local.get("storageVersion")).storageVersion;
    if (prev_version == undefined) {
        prev_version = "0.0";
    }
    const current_version = chrome.runtime.getManifest().version;
    if (current_version != prev_version) {
        // Need to migrate.
        let old_data = await chrome.storage.local.get();
        if (prev_version < "0.2") {
            console.log("Migrating from " + prev_version + "to 0.2");
            let new_data = {};
            for (let [key, value] of Object.entries(old_data)) {
                if (key.startsWith("pubRsa_") || key == "publicRsaKey" || key == "privateRsaKey") {
                    if (typeof(value) == "string") {
                        value = [value];
                    } else if (value == undefined || value == null) {
                        value = [];
                    }
                }
                new_data[key] = value;
            }
            prev_version = "0.2";
            old_data = new_data;
        }
        if (prev_version < current_version) {
            // No more changes
            prev_version = current_version;
        }
        old_data.storageVersion = current_version;
        chrome.storage.local.set(old_data);
    }
}

chrome.runtime.onMessage.addListener(
    (request, sender, sendResponse) => {
        (async () => {
            await check_migration();
            switch (request.action) {
                case "get_public_rsa_key":
                    getKeyArray("publicRsaKey", sendResponse);
                    return;
                case "get_private_rsa_key":
                    getKeyArray("privateRsaKey", sendResponse);
                    return;
                case "get_someones_rsa_key":
                    const storageKey = "pubRsa_" + request.chatId;
                    getKeyArray(storageKey, sendResponse);
                    return;
                case "set_someones_rsa_key":
                    const keyForStorage = "pubRsa_" + request.chatId;
                    chrome.storage.local.get(keyForStorage).then(result => {
                        let array_keys = result[keyForStorage];
                        if (array_keys == undefined) {
                            array_keys = [];
                        }
                        const index = array_keys.indexOf(request.value);
                        if (index != -1) {
                            array_keys.splice(index, 1);
                        }
                        array_keys.push(request.value);
                        chrome.storage.local.set({[keyForStorage]: array_keys}).then(sendResponse);
                    });
                    return;
                case "get":
                    chrome.storage.local.get(FIELDS).then(sendResponse);
                    return;

                case "set":
                    chrome.storage.local.set(request.data).then(sendResponse);
                    return;

                case "reload":
                    try {
                        chrome.tabs.reload(sender.tab.id);
                    } catch (e) {

                    }
                    return;
                case "set_for_tab":
                    chrome.storage.session.set({[String(sender.tab.id)]: request.data});
                    return;

                case "get_for_tab":
                    const key = String(sender.tab.id);
                    chrome.storage.session.get({[String(sender.tab.id)]: {}}).then(result => {
                    sendResponse(result[key]);
                    });
                    return;
                case "get_all_data":
                    chrome.storage.local.get().then(sendResponse);
                    return;
                case "set_all_data":
                    chrome.storage.local.clear().then(
                        () => {chrome.storage.local.set(request.data).then(sendResponse);}
                    );
                    return;

                default:
                    throw new Error("Unknown action: " + request.action);
            }
        })();
        return true;
    },
);
