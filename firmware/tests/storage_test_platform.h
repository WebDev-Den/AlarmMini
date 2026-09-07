#pragma once

// Host-only Arduino/LittleFS boundary. The tests compile the production storage
// implementation and real ArduinoJson; only hardware and filesystem I/O are fake.
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <map>
#include <stdexcept>
#include <string>

using std::min;
using String = std::string;

class Print
{
public:
    virtual ~Print() = default;
    virtual size_t write(uint8_t byte) = 0;
    virtual size_t write(const uint8_t *bytes, size_t size)
    {
        size_t count = 0;
        while (count < size && write(bytes[count]))
            ++count;
        return count;
    }
    size_t print(const char *value) { return write((const uint8_t *)value, strlen(value)); }
    size_t print(char value) { return write((uint8_t)value); }
};

struct PowerCut : std::runtime_error
{
    PowerCut() : std::runtime_error("simulated power cut") {}
};

struct StorageFaults
{
    int cutAfter = -1;
    int operations = 0;
    bool failOpenWrite = false;
    bool failBackupRename = false;
    bool failMainRename = false;
    bool corruptFlush = false;
    bool shortWrite = false;
    bool failFlush = false;
    std::string failRenameTo;
    void mutation()
    {
        if (++operations == cutAfter)
            throw PowerCut();
    }
};

inline StorageFaults faults;
inline std::map<std::string, std::string> files;
inline uint32_t fakeMillis = 0;
inline unsigned long millis() { return fakeMillis; }
inline void yield() {}
constexpr int SeekSet = 0;

class File : public Print
{
public:
    File() = default;
    File(const char *path) : path_(path), open_(true) {}
    explicit operator bool() const { return open_; }
    size_t size() const { return files.at(path_).size(); }
    int read()
    {
        auto &data = files.at(path_);
        return position_ < data.size() ? (uint8_t)data[position_++] : -1;
    }
    size_t readBytes(char *buffer, size_t size)
    {
        size_t count = 0;
        for (; count < size; ++count)
        {
            const int byte = read();
            if (byte < 0)
                break;
            buffer[count] = (char)byte;
        }
        return count;
    }
    size_t read(uint8_t *buffer, size_t size) { return readBytes((char *)buffer, size); }
    bool seek(size_t offset, int) { position_ = offset; return offset <= size(); }
    size_t write(uint8_t byte) override { return write(&byte, 1); }
    size_t write(const uint8_t *data, size_t size) override
    {
        if (faults.shortWrite && size)
            --size;
        files[path_].append((const char *)data, size);
        faults.mutation();
        return size;
    }
    void flush()
    {
        if (faults.corruptFlush && !files[path_].empty())
            files[path_][0] ^= 1;
        faults.mutation();
    }
    int getWriteError() const { return faults.failFlush; }
    void close() { open_ = false; }

private:
    std::string path_;
    size_t position_ = 0;
    bool open_ = false;
};

struct FakeLittleFS
{
    File open(const char *path, const char *mode)
    {
        if (mode[0] == 'w')
        {
            if (faults.failOpenWrite)
                return {};
            files[path].clear();
            faults.mutation();
        }
        if (mode[0] == 'a' && !files.count(path))
        {
            files[path] = "";
            faults.mutation();
        }
        if (!files.count(path))
            return {};
        return File(path);
    }
    bool exists(const char *path) { return files.count(path) != 0; }
    bool remove(const char *path)
    {
        const bool removed = files.erase(path) != 0;
        faults.mutation();
        return removed;
    }
    bool rename(const char *source, const char *destination)
    {
        if (!files.count(source) ||
            faults.failRenameTo == destination ||
            (faults.failBackupRename && std::string(destination) == "/amcfg.bak") ||
            (faults.failMainRename && std::string(destination) == "/amcfg.json"))
            return false;
        files[destination] = files.at(source);
        files.erase(source);
        faults.mutation();
        return true;
    }
};

inline FakeLittleFS LittleFS;
constexpr int WL_CONNECTED = 3;
struct FakeIP
{
    String toString() { return "192.0.2.1"; }
};
struct FakeWiFi
{
    int state = WL_CONNECTED;
    String ssid;
    String password;
    int status() { return state; }
    String SSID() { return ssid; }
    String psk() { return password; }
    FakeIP localIP() { return {}; }
};
inline FakeWiFi WiFi;
inline String platformResetReason() { return "power_on"; }
inline String platformResetInfo() { return "synthetic reset"; }
