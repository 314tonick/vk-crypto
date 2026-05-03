const FIELDS = {
    field1: true
};

chrome.runtime.onMessage.addListener(
    (request, sender, sendResponse) => {
        switch (request.action) {
            case "get_public_rsa_key":
                chrome.storage.local.get("publicRsaKey").then(result => sendResponse({"result": result["publicRsaKey"]}));
                return true;
            case "get_private_rsa_key":
                chrome.storage.local.get("privateRsaKey").then(result => sendResponse({"result": result["privateRsaKey"]}));
                return true;
            case "get_someones_rsa_key":
                chrome.storage.local.get("pubRsa_" + request.chatId).then(result => sendResponse({"result": result["pubRsa_" + request.chatId]}));
                return true;
            case "set_someones_rsa_key":
                keyForStorage = "pubRsa_" + request.chatId;
                chrome.storage.local.set({[keyForStorage]: request.value}).then(sendResponse);
                return true;
            case "get":
                chrome.storage.local.get(FIELDS).then(sendResponse);
                return true;

            case "set":
                chrome.storage.local.set(request.data).then(sendResponse);
                return true;

            case "reload":
                try {
                    chrome.tabs.reload(sender.tab.id);
                    return true;
                } catch (e) {
                    return false;
                }
            
            case "set_for_tab":
                chrome.storage.session.set({[String(sender.tab.id)]: request.data});
                return true;

            case "get_for_tab":
                const key = String(sender.tab.id);
                chrome.storage.session.get({[String(sender.tab.id)]: {}}).then(result => {
                  sendResponse(result[key]);
                });;
                return true;

            default:
                throw new Error("Unknown action: " + request.action);
        }
    },
);
