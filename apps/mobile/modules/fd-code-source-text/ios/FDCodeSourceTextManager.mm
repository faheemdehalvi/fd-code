#import <React/RCTUIManager.h>
#import <React/RCTViewManager.h>

@interface FDCodeSourceTextManager : RCTViewManager
@end

@implementation FDCodeSourceTextManager

RCT_EXPORT_MODULE(FDCodeSourceText)

- (UIView *)view {
  return [[UIView alloc] init];
}

@end

@interface FDCodeSourceTextRunManager : RCTViewManager
@end

@implementation FDCodeSourceTextRunManager

RCT_EXPORT_MODULE(FDCodeSourceTextRun)

- (UIView *)view {
  return nil;
}

@end
