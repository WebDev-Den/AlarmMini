#pragma once
#include "tryvoha_contract.h"
#include <fstream>
#include <iterator>

static std::string tryvohaAlert(const char *slug, const char *type = "state", const char *parent = "", const char *level = "red") {
    return std::string("{\"slug\":\"") + slug + "\",\"type\":\"" + type + "\",\"oblast_slug\":\"" + parent +
        "\",\"level\":\"" + level + "\",\"name_uk\":\"Назва { [ \\\" тест\"}";
}

static std::string tryvohaEnvelope(const std::string &entries, unsigned count, const char *stamp = "2026-10-16T12:00:00.123456Z") {
    return std::string("{\"alerts\":[") + entries + "],\"active\":" + std::to_string(count) + ",\"updated_at\":\"" + stamp + "\"}";
}

static bool parseTryvoha(const std::string &json, uint8_t *states, time_t now) {
    tryvoha::Parser parser;
    for (char c : json) if (!parser.write(c)) return false;
    time_t updated = 0;
    return parser.finish(states, now, updated);
}

static void testTryvohaParser() {
    const time_t now = tryvoha::timestamp("2026-10-16T12:00:30Z");
    assert(now == 1792152030);
    uint8_t states[25];
    std::fill_n(states, 25, 7);
    for (unsigned i = 0; i < 24; ++i) {
        assert(parseTryvoha(tryvohaEnvelope(tryvohaAlert(tryvoha::SLUGS[i]), 1), states, now));
        for (unsigned j = 0; j < 24; ++j) assert(states[j] == (i == j));
        assert(states[24] == 7);
        const auto red = tryvohaAlert("district-red", "district", tryvoha::SLUGS[i], "red");
        const auto yellow = tryvohaAlert("district-yellow", "district", tryvoha::SLUGS[i], "yellow");
        const auto wholeRed = tryvohaAlert(tryvoha::SLUGS[i]);
        const auto wholeYellow = tryvohaAlert(tryvoha::SLUGS[i], "state", "", "yellow");
        const auto communityRed = tryvohaAlert("community-red", "community", tryvoha::SLUGS[i]);
        const auto communityYellow = tryvohaAlert("community-yellow", "community", tryvoha::SLUGS[i], "yellow");
        assert(parseTryvoha(tryvohaEnvelope(wholeYellow, 1), states, now));
        for (unsigned j = 0; j < 24; ++j) assert(states[j] == (i == j ? 2 : 0));
        for (const auto &partial : {yellow, communityYellow, yellow + ',' + communityYellow}) {
            assert(parseTryvoha(tryvohaEnvelope(partial, partial == yellow || partial == communityYellow ? 1 : 2), states, now));
            for (unsigned j = 0; j < 24; ++j) assert(states[j] == (i == j ? 5 : 0));
        }
        for (const auto &partial : {red, communityRed, red + ',' + communityRed}) {
            assert(parseTryvoha(tryvohaEnvelope(partial, partial == red || partial == communityRed ? 1 : 2), states, now));
            for (unsigned j = 0; j < 24; ++j) assert(states[j] == (i == j ? 4 : 0));
        }
        // Any combination of scopes is mixed, independent of order and duplicates.
        for (const auto &r : {red, communityRed, wholeRed}) {
            for (const auto &y : {yellow, communityYellow, wholeYellow}) {
                for (const auto &mixed : {r + ',' + y, y + ',' + r, r + ',' + y + ',' + r}) {
                    assert(parseTryvoha(tryvohaEnvelope(mixed, mixed == r + ',' + y + ',' + r ? 3 : 2), states, now));
                    for (unsigned j = 0; j < 24; ++j) assert(states[j] == (i == j ? 3 : 0));
                }
            }
        }
        for (const auto &full : {wholeRed + ',' + red, red + ',' + wholeRed}) {
            assert(parseTryvoha(tryvohaEnvelope(full, 2), states, now));
            assert(states[i] == 1);
        }
        for (const auto &full : {wholeYellow + ',' + yellow, yellow + ',' + wholeYellow}) {
            assert(parseTryvoha(tryvohaEnvelope(full, 2), states, now));
            assert(states[i] == 2);
        }
        assert(parseTryvoha(tryvohaEnvelope(yellow + ',' + yellow, 2), states, now));
        assert(states[i] == 5);
        assert(parseTryvoha(tryvohaEnvelope(red + ',' + red, 2), states, now));
        assert(states[i] == 4); // A new snapshot clears prior levels and whole coverage.
        assert(states[24] == 7);
    }
    const auto entries = tryvohaAlert("brovarskii-raion", "district", "kyivska", "yellow") + "," +
        tryvohaAlert("community", "community", "dnipropetrovska") + "," +
        tryvohaAlert("m-zaporizzia-ta-zaporizka-teritorialna-gromada") + "," +
        tryvohaAlert("m-xarkiv-ta-xarkivska-teritorialna-gromada") + "," + tryvohaAlert("kyiv");
    assert(parseTryvoha(tryvohaEnvelope(entries, 5), states, now));
    assert(states[2] == 4 && states[6] == 4 && states[8] == 3 && states[18] == 4);
    for (const char *city : {"kyiv", "m-zaporizzia-ta-zaporizka-teritorialna-gromada", "m-xarkiv-ta-xarkivska-teritorialna-gromada"}) {
        const int index = tryvoha::regionIndex(city);
        assert(parseTryvoha(tryvohaEnvelope(tryvohaAlert(city), 1), states, now));
        assert(states[index] == 4);
        assert(parseTryvoha(tryvohaEnvelope(tryvohaAlert(city, "state", "", "yellow"), 1), states, now));
        assert(states[index] == 5);
        assert(parseTryvoha(tryvohaEnvelope(tryvohaAlert(city) + ',' +
            tryvohaAlert(tryvoha::SLUGS[index], "state", "", "yellow"), 2), states, now));
        assert(states[index] == 3);
    }
    assert(parseTryvoha(tryvohaEnvelope(tryvohaAlert("red", "district", "kyivska") + ',' +
        tryvohaAlert("yellow", "community", "dnipropetrovska", "yellow"), 2), states, now));
    assert(states[8] == 4 && states[2] == 5); // Never combine levels across oblasts.
    assert(parseTryvoha(tryvohaEnvelope("", 0), states, now));
    for (unsigned i = 0; i < 24; ++i) assert(states[i] == 0);
    assert(states[24] == 7);
    std::string large;
    for (int i = 0; i < 200; ++i) {
        if (i) large += ',';
        large += tryvohaAlert("brovarskii-raion", "district", "kyivska");
    }
    assert(large.size() > 20000);
    assert(parseTryvoha(tryvohaEnvelope(large, 200), states, now));
    assert(states[8] == 4); // Many child records never imply an oblast-level declaration.
    const auto valid = tryvohaEnvelope(entries, 5);
    for (const auto &bad : {std::string("{}"), std::string("[]"), valid + "x", valid + "{}",
        valid.substr(0, valid.size() - 1), tryvohaEnvelope(entries, 4), tryvohaEnvelope("null", 1),
        tryvohaEnvelope(entries + ',', 5), tryvohaEnvelope(entries, 5, "2026-10-16T11:00:00Z"),
        tryvohaEnvelope(entries, 5, "2026-10-16T12:10:00Z"), tryvohaEnvelope(entries, 5, "2026-10-16T12:00:00+00:00"),
        tryvohaEnvelope(tryvohaAlert("unknown"), 1), tryvohaEnvelope(tryvohaAlert("kyiv", "bogus"), 1),
        tryvohaEnvelope(tryvohaAlert("district", "district"), 1),
        tryvohaEnvelope(tryvohaAlert("kyiv", "state", "", "unknown"), 1),
        tryvohaEnvelope("{\"slug\":\"kyiv\",\"type\":\"state\"}", 1),
        tryvohaEnvelope(tryvohaAlert(std::string(1100, 'x').c_str()), 1),
        std::string(tryvoha::MAX_BODY + 1, ' '), valid.substr(0, 10) + std::string(1, '\0') + valid.substr(10)}) {
        std::fill_n(states, 25, 7);
        assert(!parseTryvoha(bad, states, now));
        for (auto state : states) assert(state == 7);
    }
    for (size_t cut = 0; cut < valid.size(); ++cut) assert(!parseTryvoha(valid.substr(0, cut), states, now));
    assert(!tryvoha::timestamp("2026-02-30T12:00:00Z"));
    assert(!tryvoha::timestamp("2026-10-16T24:00:00Z"));
    assert(!tryvoha::fresh(now, 0));
    assert(tryvoha::fresh(now, now + 180));
    assert(!tryvoha::fresh(now, now + 181));
    std::puts("PASS Tryvoha streaming parser: MQTT codes 0-5, whole/partial/mixed, order/duplicates, city/community, large payload, freshness, malformed/truncated data");
}
