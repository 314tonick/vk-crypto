#!/usr/bin/python3

import os
import shutil

lib = ""

def modify_file(filename):
    if filename.endswith("manifest.json"):
        print("Processing manifest file.")
        txt = open(filename, encoding="utf-8").read()
        txt = txt.replace('    "background": {\n        "service_worker": "service.js"\n    },\n', '')
        with open(filename, "w", encoding="utf-8") as f:
            f.write(txt)
    if not filename.endswith(".js"):
        return
    print("Processing js file:", filename)
    txt = open(filename, encoding="utf-8").read()
    txt = "\n" + lib + "\n" + "\n\n" + txt.replace("chrome.runtime.sendMessage", "serviceMessage")
    with open(filename, "w", encoding="utf-8") as f:
        f.write(txt)

def work(*pth):
    if pth == (".", "build"):
        return
    if len(pth) > 1 and (pth[-1].startswith(".") or pth[-1] in ("README.md", ".gitignore", "service.js")):
        return
    pth_str = os.path.join(*pth)
    if os.path.isdir(pth_str):
        os.makedirs(os.path.join("build", pth_str), exist_ok=True)
        for fl in os.listdir(pth_str):
            work(*pth, fl)
    else:
        modify_file(shutil.copy(pth_str, os.path.join("build", pth_str)))

print("Building serverless version of extension.")
if os.path.exists("vk-crypto-serviceless.zip"):
    os.remove("vk-crypto-serviceless.zip")
print("Finding library contents from service.js...")
for line in open("service.js"):
    if line.startswith("//") or line.startswith("chrome.runtime.onMessage.addListener"):
        continue
    lib = lib + line
lib = lib.strip()
if len(lib) == "":
    print("Error: library is not found or empty.")
    exit(1)
print("Copying and modifying files...")
work(".")
print("Building .zip archive...")
if os.name == "nt":
    os.system("tar -a -c -f vk-crypto-serviceless.zip -C build *")
else:
    os.system("cd build && zip ../vk-crypto-serviceless.zip * && cd ..")
print("Removing build folder...")
# shutil.rmtree("build")
print("Done. File vk-crypto-serviceless.zip generated.")