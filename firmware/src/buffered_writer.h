#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

// Bounded serialization buffer. Explicit flush lets the caller handle short or
// failed network writes instead of silently returning an incomplete JSON body.
template <typename Sink, size_t Capacity = 256>
class BufferedWriter {
public:
    explicit BufferedWriter(Sink &sink) : sink_(sink) {}
    size_t write(uint8_t byte) { return write(&byte, 1); }
    size_t write(const uint8_t *data, size_t size) {
        size_t accepted = 0;
        while (accepted < size && !failed_) {
            const size_t remaining = size - accepted;
            const size_t room = Capacity - used_;
            const size_t count = remaining < room ? remaining : room;
            memcpy(buffer_ + used_, data + accepted, count);
            used_ += count;
            accepted += count;
            if (used_ == Capacity && !flush()) break;
        }
        return accepted;
    }
    bool flush() {
        if (failed_) return false;
        size_t offset = 0;
        while (offset < used_) {
            const size_t written = sink_.write(buffer_ + offset, used_ - offset);
            if (written == 0 || written > used_ - offset) {
                failed_ = true;
                return false;
            }
            offset += written;
        }
        used_ = 0;
        return true;
    }
private:
    static_assert(Capacity > 0, "Buffer must not be empty");
    Sink &sink_;
    uint8_t buffer_[Capacity];
    size_t used_ = 0;
    bool failed_ = false;
};
