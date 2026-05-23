const popupDialogs_checkbox = document.getElementById("popupDialogs_checkbox");

let showDialogs = false;
chrome.runtime.sendMessage({action: "get_settings"})
    .then(response => {
        console.log(response);
        showDialogs = response.popupDialogs;
        popupDialogs_checkbox.checked = response.popupDialogs;
    },
);

popupDialogs_checkbox.onchange = () => {
    chrome.runtime.sendMessage({action: "set",
        data: {popupDialogs: popupDialogs_checkbox.checked}
    });
    console.log("changed setting");
    showDialogs = popupDialogs_checkbox.checked;
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.update(tabs[0].id, {url: tabs[0].url});
})};

function alert_there(msg) {
    try {if (showDialogs) {
        alert_there(msg);
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

const pub_key_label = document.getElementById("pub_key_label");
const pub_key_button = document.getElementById("pub_key_button");
const version_label = document.getElementById("version_label");
version_label.textContent = "Версия " + chrome.runtime.getManifest().version;

const export_button = document.getElementById("export_button");
export_button.onclick = async () => {
    if (!confirm_there("Вы уверены, что хотите выгрузить все данные? На текущий момент, ваш приватный ключ никак не зашифрован (это будет изменено в будущем обновлении).")) {
        return;
    }
    let data = await chrome.runtime.sendMessage({action: "get_all_data"});
    let blb = new Blob([JSON.stringify(data, null, 4)], {type: "text/plain"});
    let fake_link = document.createElement("a");
    fake_link.href = URL.createObjectURL(blb);
    fake_link.download = "vk-crypto-export.json";
    fake_link.click();
    URL.revokeObjectURL(fake_link.href);
    fake_link.remove();
}

const import_button = document.getElementById("import_button");
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
                await chrome.runtime.sendMessage({action: "set_all_data", data: data_object});
                alert_there("Данные успешно загружены.");
                location.reload();
            } catch (err) {
                alert_there("Ошибка. Формат сейва нарушен.");
            }
        };
        reader.readAsText(file);
    });
    fake_input.click();
}


chrome.runtime.sendMessage({action: "get_public_rsa_key"})
    .then(response => {
        console.log("Received: ", response);
        if (response["result"] == undefined) {
            pub_key_label.textContent = "Не сгенерирован."
            pub_key_label.style.color = "red";
            pub_key_label.title = pub_key_button.title = "Вам нужно сгенерировать ключ для работы расширения."
            return;
        }
        pub_key_label.textContent = "..." + response["result"].substring(50, 70) + "...";
        pub_key_button.onclick = () => {
            navigator.clipboard.writeText(response["result"]);
        }
    },
);
