/* Opens and closes the iPhone Duo simulator from the command line.

     hinge <degrees>      0 is closed, 180 is open flat

   Xcode 27.1 can fold the simulated phone only from a slider in Device Hub,
   and nothing in simctl does it, so a build on a machine no one is sitting at
   could photograph one display and never the other. This is run inside the
   simulator with `xcrun simctl spawn`, and posts the event that slider posts:
   a vendor defined HID event on usage page 0xFF61, usage 0x5B, carrying the
   angle in a small serialized dictionary.

   It is used by the iOS workflow only, never built into the app: the calls
   below are private to iOS, and the app has no business with them.

   The event and its payload were found by Artem Novichkov, whose hinge tool
   this is cut down from: https://github.com/artemnovichkov/hinge

   MIT License

   Copyright (c) 2026 Artem Novichkov

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:

   The above copyright notice and this permission notice shall be included in all
   copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE. */

#include <CoreFoundation/CoreFoundation.h>
#include <mach/mach_time.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

typedef struct __IOHIDEvent *IOHIDEventRef;
typedef struct __IOHIDEventSystemClient *IOHIDEventSystemClientRef;

extern IOHIDEventRef IOHIDEventCreateVendorDefinedEvent(CFAllocatorRef allocator, uint64_t timeStamp,
    uint32_t usagePage, uint32_t usage, uint32_t version, const uint8_t *data, CFIndex length, uint32_t options);
extern IOHIDEventSystemClientRef IOHIDEventSystemClientCreateWithType(CFAllocatorRef allocator, int type,
    CFDictionaryRef properties);
extern void IOHIDEventSystemClientDispatchEvent(IOHIDEventSystemClientRef client, IOHIDEventRef event);
extern CFDataRef IOCFSerialize(CFTypeRef object, CFOptionFlags options);

enum { kUsagePage = 0xFF61, kUsage = 0x5B, kClientSimple = 4, kSerializeBinary = 1 };

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: hinge <degrees>, 0 closed to 180 open\n");
    return 64;
  }
  double degrees = atof(argv[1]);
  if (degrees < 0) degrees = 0;
  if (degrees > 180) degrees = 180;

  IOHIDEventSystemClientRef client = IOHIDEventSystemClientCreateWithType(NULL, kClientSimple, NULL);
  if (!client) {
    fprintf(stderr, "hinge: no HID event system here, is this running inside the simulator?\n");
    return 1;
  }

  CFNumberRef angle = CFNumberCreate(NULL, kCFNumberDoubleType, &degrees);
  const void *keys[] = {CFSTR("provider"), CFSTR("source"), CFSTR("type"), CFSTR("value")};
  const void *values[] = {CFSTR("com.apple.Virtualization"), CFSTR("hinge-slider-control"), CFSTR("range"), angle};
  CFDictionaryRef payload = CFDictionaryCreate(NULL, keys, values, 4,
      &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFDataRef data = IOCFSerialize(payload, kSerializeBinary);

  int sent = 0;
  if (data) {
    IOHIDEventRef event = IOHIDEventCreateVendorDefinedEvent(NULL, mach_absolute_time(), kUsagePage, kUsage, 0,
        CFDataGetBytePtr(data), CFDataGetLength(data), 0);
    if (event) {
      IOHIDEventSystemClientDispatchEvent(client, event);
      CFRelease(event);
      sent = 1;
    }
    CFRelease(data);
  }
  CFRelease(payload);
  CFRelease(angle);

  /* the event system is given a moment to deliver before the process ends */
  usleep(100000);
  if (!sent) {
    fprintf(stderr, "hinge: the event could not be made\n");
    return 1;
  }
  printf("hinge: %.0f degrees\n", degrees);
  return 0;
}
