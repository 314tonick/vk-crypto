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

async function getKeyArray(key) {
    const result = await chrome.storage.local.get(key);
    let last_key = undefined;
    let real_result = result[key];
    if (Array.isArray(real_result)) {
        if (real_result.length == 0) {
            real_result = undefined;
        } else {
            last_key = real_result[real_result.length - 1];
        }
    }
    return {result: last_key, all: real_result};
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
async function serviceMessage(request) {
    await check_migration();
    switch (request.action) {
        case "get_public_rsa_key":
            return await getKeyArray("publicRsaKey");
        case "get_private_rsa_key":
            return await getKeyArray("privateRsaKey");
        case "get_someones_rsa_key": {
            const storageKey = "pubRsa_" + request.chatId;
            return await getKeyArray(storageKey);
        }
        case "add_someones_rsa_key": {
            const keyForStorage = "pubRsa_" + request.chatId;
            const result = await chrome.storage.local.get(keyForStorage);
            let array_keys = result[keyForStorage];
            if (array_keys == undefined) {
                array_keys = [];
            }
            const index = array_keys.indexOf(request.value);
            if (index != -1) {
                array_keys.splice(index, 1);
            }
            array_keys.push(request.value);
            await chrome.storage.local.set({
                [keyForStorage]: array_keys
            });
            return true;
        }
        case "add_rsa_key": {
            let pubKeys = await chrome.storage.local.get("publicRsaKey");
            let privKeys = await chrome.storage.local.get("privateRsaKey");
            pubKeys = pubKeys.publicRsaKey;
            privKeys = privKeys.privateRsaKey;
            if (privKeys.length != pubKeys.length) {
                throw new Error(
                    "Number of public keys and private are different. What the hell???"
                );
            }
            const index = pubKeys.indexOf(request.publicRsaKey);
            if (index != -1) {
                if (privKeys[index] != request.privateRsaKey) {
                    throw new Error(
                        "Existing in base (or given) keypair is wrong. What the hell???"
                    );
                }
                pubKeys.splice(index, 1);
                privKeys.splice(index, 1);
            }
            pubKeys.push(request.publicRsaKey);
            privKeys.push(request.privateRsaKey);
            await chrome.storage.local.set({
                publicRsaKey: pubKeys,
                privateRsaKey: privKeys
            });
            return true;
        }
        case "get":
            return await chrome.storage.local.get({field1: true});
        case "set":
            await chrome.storage.local.set(request.data);
            return true;
        case "reload":
            try {
                await chrome.tabs.reload(request.tabId);
            } catch (e) {}
            return true;
        case "set_for_tab":
            await chrome.storage.session.set({
                [String(request.tabId)]: request.data
            });
            return true;
        case "get_for_tab": {
            const key = String(request.tabId);
            const result = await chrome.storage.session.get({
                [key]: {}
            });
            return result[key];
        }
        case "get_all_data":
            return await chrome.storage.local.get();
        case "set_all_data":
            await chrome.storage.local.clear();
            await chrome.storage.local.set(request.data);
            return true;
        default:
            throw new Error("Unknown action: " + request.action);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {serviceMessage(request).then(sendResponse);return true;});
