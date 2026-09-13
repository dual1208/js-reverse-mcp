#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <mach/mach.h>
#include <mach/ndr.h>
#include <servers/bootstrap.h>
#include <libproc.h>
#include <stddef.h>
#pragma pack(push,4)
typedef struct { mach_msg_header_t head; mach_msg_body_t body; mach_msg_ool_descriptor_t pixels; NDR_record_t ndr; ProcessSerialNumber psn; uint32_t iconServices; uint32_t width; uint32_t bytesPerRow; uint32_t bitmapInfo; uint32_t byteCount; } BitmapMessage;
#pragma pack(pop)
_Static_assert(sizeof(BitmapMessage)==80,"Unexpected Mach ABI");
_Static_assert(offsetof(BitmapMessage,psn)==52,"Unexpected PSN offset");
int main(int argc,char **argv) { @autoreleasepool {
  if (argc != 3) return 2;
  pid_t pid=atoi(argv[1]); char target[PROC_PIDPATHINFO_MAXSIZE]={0};
  if (proc_pidpath(pid,target,sizeof(target)) <= 0 || strcmp(target,"/private/tmp/js-reverse-icon-research/Icon Fixture.app/Contents/MacOS/IconFixture") != 0) { fprintf(stderr,"Only the disposable icon fixture is allowed; got %s\n",target); return 3; }
  ProcessSerialNumber psn; OSStatus status=GetProcessForPID(pid,&psn); if(status) return 4;
  NSImage *image=[NSWorkspace.sharedWorkspace iconForFile:@(argv[2])];
  CGRect rect=CGRectMake(0,0,256,256); CGImageRef cg=[image CGImageForProposedRect:&rect context:nil hints:nil]; if(!cg) return 5;
  CGColorSpaceRef space=CGColorSpaceCreateWithName(kCGColorSpaceExtendedSRGB);
  CGContextRef context=CGBitmapContextCreate(NULL,256,256,16,256*8,space,0x1101); CGColorSpaceRelease(space); if(!context) return 6;
  CGContextDrawImage(context,CGRectMake(0,0,256,256),cg);
  mach_port_t dock=MACH_PORT_NULL; kern_return_t lookup=bootstrap_look_up(bootstrap_port,"com.apple.dock.server",&dock); if(lookup) { fprintf(stderr,"lookup=%d\n",lookup); return 7; }
  BitmapMessage message={0};
  message.head.msgh_bits=MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND,0)|MACH_MSGH_BITS_COMPLEX;
  message.head.msgh_size=sizeof(message); message.head.msgh_remote_port=dock; message.head.msgh_id=0x1791b;
  message.body.msgh_descriptor_count=1;
  message.pixels.address=CGBitmapContextGetData(context); message.pixels.size=256*256*8; message.pixels.deallocate=FALSE; message.pixels.copy=MACH_MSG_PHYSICAL_COPY; message.pixels.type=MACH_MSG_OOL_DESCRIPTOR;
  message.ndr=NDR_record; message.psn=psn; message.width=256; message.bytesPerRow=256*8; message.bitmapInfo=0x1101; message.byteCount=256*256*8;
  kern_return_t sent=mach_msg(&message.head,MACH_SEND_MSG|MACH_SEND_TIMEOUT,sizeof(message),0,MACH_PORT_NULL,2000,MACH_PORT_NULL);
  printf("fixture_pid=%d psn=(0x%x 0x%x) transport_status=%d icon=%s\n",pid,psn.highLongOfPSN,psn.lowLongOfPSN,sent,argv[2]);
  mach_port_deallocate(mach_task_self(),dock); CGContextRelease(context); return sent ? 8 : 0;
}}
