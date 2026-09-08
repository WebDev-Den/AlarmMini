#include <cassert>
#include <iostream>
#include "storage_under_test.cpp"

void loggerWritef(uint8_t, uint16_t, const char *, ...) {}
void resetTraceSetStage(const char *, bool) {}

static void credentials(const char *ssid)
{
    snprintf(gConfig.wifiSsid, sizeof(gConfig.wifiSsid), "%s", ssid);
    snprintf(gConfig.wifiPass, sizeof(gConfig.wifiPass), "synthetic-test-password");
}

static void reboot()
{
    faults = {};
    assert(storageInit());
}

static size_t checkPowerCuts(const std::map<std::string, std::string> &baseline)
{
    files = baseline;
    reboot();
    credentials("new-network");
    assert(storageSaveCurrentConfig(true));
    const int operations = faults.operations;
    for (int cut = 1; cut <= operations; ++cut)
    {
        files = baseline;
        reboot();
        credentials("new-network");
        faults.cutAfter = cut;
        try { storageSaveCurrentConfig(true); }
        catch (const PowerCut &) {}
        reboot();
        const std::string recovered = gConfig.wifiSsid;
        assert(recovered == "old-network" || recovered == "new-network");
    }
    return operations;
}

int main()
{
    reboot();
    credentials("old-network");
    assert(storageSaveCurrentConfig(true));
    const auto baseline = files;
    const std::string validEnvelope = files.at(CONFIG_PATH);

    size_t powerCuts = checkPowerCuts(baseline);
    auto recoveredBackup = baseline;
    recoveredBackup[CONFIG_BAK_PATH] = validEnvelope;
    recoveredBackup[CONFIG_PATH] = "{broken-main";
    powerCuts += checkPowerCuts(recoveredBackup);

    // A complete temporary config is recoverable even without either old file.
    files = {{CONFIG_TMP_PATH, validEnvelope}};
    reboot();
    assert(std::string(gConfig.wifiSsid) == "old-network");
    assert(files.count(CONFIG_PATH) && !files.count(CONFIG_TMP_PATH));

    // A failed recovery cannot truncate the only usable copy on a later save.
    files = {{CONFIG_TMP_PATH, validEnvelope}};
    faults = {};
    faults.failMainRename = true;
    assert(!storageInit());
    credentials("new-network");
    assert(!storageSaveCurrentConfig(true));
    assert(files.at(CONFIG_TMP_PATH) == validEnvelope);
    reboot();
    assert(std::string(gConfig.wifiSsid) == "old-network");

    // CRC zero is a checksum value, never an instruction to bypass validation.
    DynamicJsonDocument envelope(CONFIG_JSON_CAPACITY + 2048);
    assert(!deserializeJson(envelope, validEnvelope));
    envelope["crc"] = 0;
    std::string invalidCrc;
    serializeJson(envelope, invalidCrc);
    files = {{CONFIG_PATH, invalidCrc}, {CONFIG_BAK_PATH, validEnvelope}};
    reboot();
    assert(gConfigSource == CONFIG_BAK_PATH);

    // Invalid files must be preserved when no candidate can be loaded.
    files = {{CONFIG_PATH, "{truncated"}, {CONFIG_BAK_PATH, "{also-truncated"}};
    const auto invalidFiles = files;
    faults = {};
    assert(!storageInit());
    assert(files == invalidFiles);

    for (int failure = 0; failure < 5; ++failure)
    {
        files = baseline;
        reboot();
        credentials("new-network");
        faults.failBackupRename = failure == 0;
        faults.failMainRename = failure == 1;
        faults.corruptFlush = failure == 2;
        faults.shortWrite = failure == 3;
        faults.failFlush = failure == 4;
        assert(!storageSaveCurrentConfig(true));
        reboot();
        const std::string restored = gConfig.wifiSsid;
        assert(restored == "old-network" || restored == "new-network");
    }

    // Failed JSON saves leave the active config unchanged and report failure.
    files = baseline;
    reboot();
    DynamicJsonDocument edited(CONFIG_JSON_CAPACITY);
    storagePopulateJson(edited);
    edited["w"]["s"] = "new-network";
    faults.failOpenWrite = true;
    char error[32]{};
    assert(!storageSaveConfigFromJson(edited.as<JsonVariantConst>(), true, error, sizeof(error)));
    assert(std::string(error) == "save_failed");
    assert(std::string(gConfig.wifiSsid) == "old-network");

    // WiFi accepts SSIDs up to 32 bytes and treats boundary spaces as data.
    faults = {};
    edited["w"]["s"] = "123456789012345678901234567890123";
    assert(!storageSaveConfigFromJson(edited.as<JsonVariantConst>(), true, error, sizeof(error)));
    assert(std::string(error) == "bad_w");
    edited["w"]["s"] = " 123456789012345678901234567890 ";
    assert(storageSaveConfigFromJson(edited.as<JsonVariantConst>(), true, error, sizeof(error)));
    assert(strlen(gConfig.wifiSsid) == 32 && gConfig.wifiSsid[0] == ' ' && gConfig.wifiSsid[31] == ' ');
    files = baseline;
    reboot();

    // A transient SDK state must not erase or change the saved WiFi credentials.
    faults = {};
    WiFi.state = 0;
    assert(!storageSyncWifiCredentials());
    WiFi.state = WL_CONNECTED;
    WiFi.ssid = "";
    assert(!storageSyncWifiCredentials());
    WiFi.ssid = "old-network";
    WiFi.password = "";
    assert(!storageSyncWifiCredentials());
    assert(std::string(gConfig.wifiPass) == "synthetic-test-password");
    assert(faults.operations == 0);
    WiFi.ssid = "new-network";
    WiFi.password = "new-test-password";
    faults.failOpenWrite = true;
    assert(!storageSyncWifiCredentials());
    assert(std::string(gConfig.wifiSsid) == "old-network");
    assert(std::string(gConfig.wifiPass) == "synthetic-test-password");
    faults = {};
    assert(storageSyncWifiCredentials());
    reboot();
    assert(std::string(gConfig.wifiSsid) == "new-network");

    // Optional reserve URL is backward compatible, transactional and survives reboot.
    storagePopulateJson(edited);
    edited["fu"] = "https://reserve.example/alerts.json";
    edited["ft"] = "test-only-token";
    assert(storageSaveConfigFromJson(edited.as<JsonVariantConst>(), true, error, sizeof(error)));
    reboot();
    assert(std::string(gConfig.fallbackUrl) == "https://reserve.example/alerts.json");
    assert(std::string(gConfig.fallbackToken) == "test-only-token");
    edited["ft"] = "token\r\nInjected: yes";
    assert(!storageSaveConfigFromJson(edited.as<JsonVariantConst>(), true, error, sizeof(error)));
    assert(std::string(error) == "bad_fallback_token");
    edited["ft"] = "test-only-token";
    edited["fu"] = "javascript:alert(1)";
    assert(!storageSaveConfigFromJson(edited.as<JsonVariantConst>(), true, error, sizeof(error)));
    assert(std::string(error) == "bad_fallback_url");
    edited["fu"] = "https://another.example/alerts.json";
    faults.failOpenWrite = true;
    assert(!storageSaveConfigFromJson(edited.as<JsonVariantConst>(), true, error, sizeof(error)));
    assert(std::string(gConfig.fallbackUrl) == "https://reserve.example/alerts.json");
    faults = {};
    std::string maxUrl = "https://reserve.example/";
    maxUrl.resize(255, 'x');
    edited["fu"] = maxUrl;
    edited["ft"] = std::string(511, 't');
    assert(!edited.overflowed());
    assert(storageSaveConfigFromJson(edited.as<JsonVariantConst>(), true, error, sizeof(error)));
    reboot();
    assert(strlen(gConfig.fallbackToken) == 511 && strlen(gConfig.fallbackUrl) == 255);
    edited.remove("fu");
    edited.remove("ft");
    assert(storageSaveConfigFromJson(edited.as<JsonVariantConst>(), true, error, sizeof(error)));
    reboot();
    assert(!gConfig.fallbackUrl[0]);
    assert(!gConfig.fallbackToken[0]);

    // A maximum palette and maximum-length settings fit on the ESP8266 too.
    const AppConfig legacy = gConfig;
    gConfig.stateColorCount = MAX_CUSTOM_STATES;
    for (uint8_t i = 0; i < MAX_CUSTOM_STATES; ++i)
        gConfig.stateColors[i] = {uint8_t(240 + i), {255,128,i,255}, {i,0,255,20}};
    const auto fillField = [](char *field, size_t size) { memset(field, 'x', size - 1); field[size - 1] = 0; };
    fillField(gConfig.mqttHost, sizeof(gConfig.mqttHost));
    fillField(gConfig.mqttTopic, sizeof(gConfig.mqttTopic));
    fillField(gConfig.mqttUser, sizeof(gConfig.mqttUser));
    fillField(gConfig.mqttPass, sizeof(gConfig.mqttPass));
    fillField(gConfig.wifiSsid, 33);
    fillField(gConfig.wifiPass, sizeof(gConfig.wifiPass));
    fillField(gConfig.ntpServer1, sizeof(gConfig.ntpServer1));
    fillField(gConfig.ntpServer2, sizeof(gConfig.ntpServer2));
    fillField(gConfig.ntpServer3, sizeof(gConfig.ntpServer3));
    fillField(gConfig.adminPassword, sizeof(gConfig.adminPassword));
    fillField(gConfig.fallbackToken, sizeof(gConfig.fallbackToken));
    strcpy(gConfig.fallbackUrl, maxUrl.c_str());
    gConfig.hasLegacySoundConfig = true;
    gConfig.legacySound.enabled = true;
    std::fill_n(gConfig.legacySound.regions, REGIONS_COUNT, true);
    storagePopulateJson(edited);
    assert(!edited.overflowed());
    std::string fullPalette;
    serializeJson(edited, fullPalette);
    edited.clear();
    assert(!deserializeJson(edited, fullPalette)); // Includes owned key/string storage.
    assert(storageSaveConfigFromJson(edited.as<JsonVariantConst>(), true, error, sizeof(error)));
    reboot();
    assert(gConfig.stateColorCount == MAX_CUSTOM_STATES && gConfig.stateColors[15].state == 255);
    assert(gConfig.stateColors[15].day.b == 15 && gConfig.stateColors[15].night.r == 15);
    assert(strlen(gConfig.fallbackToken) == 511);
    assert(gConfig.hasLegacySoundConfig && gConfig.legacySound.enabled);
    edited["sc"]["255"][0] = 256;
    assert(!storageSaveConfigFromJson(edited.as<JsonVariantConst>(), true, error, sizeof(error)));
    assert(std::string(error) == "bad_state_colors" && gConfig.stateColors[15].day.r == 255);
    edited["sc"]["255"][0] = 255;
    edited["sc"]["2"].to<JsonArray>().add(0); // 17th entry must not be truncated.
    assert(!storageSaveConfigFromJson(edited.as<JsonVariantConst>(), true, error, sizeof(error)));
    edited["sc"].remove("2");
    for (const char *badKey : {"0", "1", "02", "256", "-2", "x"}) {
        storagePopulateJson(edited);
        edited["sc"].to<JsonObject>();
        auto rgba = edited["sc"][badKey].to<JsonArray>();
        for (int i = 0; i < 8; ++i) rgba.add(0);
        assert(!storageSaveConfigFromJson(edited.as<JsonVariantConst>(), true, error, sizeof(error)));
    }
    gConfig = legacy;
    storagePopulateJson(edited);
    assert(!edited.containsKey("sc"));
    edited.remove("z");
    assert(storageSaveConfigFromJson(edited.as<JsonVariantConst>(), true, error, sizeof(error)));
    reboot(); assert(gConfig.stateColorCount == 0 && !gConfig.hasLegacySoundConfig);
    storagePopulateJson(edited); assert(!edited.containsKey("z"));

    std::cout << "PASS: maximum palette round-trip/validation/legacy config; " << powerCuts
              << " power cuts; temp/backup recovery; CRC; invalid-file preservation; "
                 "short writes; flush/rename failures; transactional save; WiFi sync\n";
}
