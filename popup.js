const field1_checkbox = document.getElementById("field1_checkbox");

chrome.runtime
    .sendMessage({action: "get"})
    .then(response => {
        console.log(response);
        field1_checkbox.checked = response.field1;
    },
);

field1_checkbox.onchange = () => {
    chrome.runtime.sendMessage({action: "set",
        data: {field1: field1_checkbox.checked}
    });
    console.log("something");
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.update(tabs[0].id, {url: tabs[0].url});
})};

const pub_key_label = document.getElementById("pub_key_label");
const pub_key_button = document.getElementById("pub_key_button");

chrome.runtime
    .sendMessage({action: "get_public_rsa_key"})
    .then(response => {
        console.log(response);
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
