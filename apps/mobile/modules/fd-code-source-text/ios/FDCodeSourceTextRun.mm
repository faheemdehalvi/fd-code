#import "FDCodeSourceTextRun.h"
#import <React/RCTFabricComponentsPlugins.h>
#import "FDCodeSourceTextRunComponentDescriptor.h"
#import <react/renderer/components/FDCodeSourceTextSpec/Props.h>
#import <react/renderer/components/FDCodeSourceTextSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

@interface FDCodeSourceTextRun () <RCTFDCodeSourceTextRunViewProtocol>

@end

@implementation FDCodeSourceTextRun {
  NSString *_text;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<
      FDCodeSourceTextRunComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps =
        std::make_shared<const FDCodeSourceTextRunProps>();
    _props = defaultProps;
  }
  return self;
}

- (void)updateProps:(Props::Shared const &)props
           oldProps:(Props::Shared const &)oldProps {
  const auto &oldViewProps =
      *std::static_pointer_cast<FDCodeSourceTextRunProps const>(_props);
  const auto &newViewProps =
      *std::static_pointer_cast<FDCodeSourceTextRunProps const>(props);

  if (newViewProps.text != oldViewProps.text) {
    NSString *text = [NSString stringWithUTF8String:newViewProps.text.c_str()];
    _text = text;
  }

  [super updateProps:props oldProps:oldProps];
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

Class<RCTComponentViewProtocol> FDCodeSourceTextRunCls(void) {
  return FDCodeSourceTextRun.class;
}

@end
