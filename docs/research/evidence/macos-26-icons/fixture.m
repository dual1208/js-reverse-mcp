#import <AppKit/AppKit.h>
#include <unistd.h>
int main(int argc, char **argv) { @autoreleasepool {
  NSApplication *app=NSApplication.sharedApplication;
  [app setActivationPolicy:NSApplicationActivationPolicyRegular];
  NSString *label=argc>1 ? @(argv[1]) : @"A";
  NSMenu *menu=[NSMenu new]; NSMenuItem *item=[NSMenuItem new]; [menu addItem:item];
  NSMenu *submenu=[NSMenu new]; [submenu addItemWithTitle:@"Quit icon research fixture" action:@selector(terminate:) keyEquivalent:@"q"]; item.submenu=submenu; app.mainMenu=menu;
  NSWindow *window=[[NSWindow alloc] initWithContentRect:NSMakeRect(100,100,480,150) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
  window.title=[@"Icon research — fixture " stringByAppendingString:label];
  NSTextField *text=[NSTextField wrappingLabelWithString:@"Temporary test app. Both fixtures start with a Chrome icon. An external test helper will try to give one a Calculator icon and the other a TextEdit icon. These apps close automatically; your browsers are untouched."];
  text.frame=NSMakeRect(25,25,430,100); [window.contentView addSubview:text]; [window orderFront:nil];
  [app finishLaunching];
  app.applicationIconImage=[NSWorkspace.sharedWorkspace iconForFile:@"/Applications/Google Chrome.app"];
  [app.dockTile display];
  NSString *ready=[NSString stringWithFormat:@"/tmp/js-reverse-icon-research/fixture-%@.pid",label];
  [[NSString stringWithFormat:@"%d",getpid()] writeToFile:ready atomically:YES encoding:NSUTF8StringEncoding error:nil];
  NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:180];
  [NSTimer scheduledTimerWithTimeInterval:0.5 repeats:YES block:^(NSTimer *timer) {
    if ([deadline timeIntervalSinceNow] < 0 || [NSFileManager.defaultManager fileExistsAtPath:@"/tmp/js-reverse-icon-research/stop-fixtures"]) [app terminate:nil];
  }];
  [app run];
}}
