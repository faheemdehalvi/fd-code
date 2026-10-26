#pragma once

#include <react/renderer/components/FDCodeSourceTextSpec/EventEmitters.h>
#include <react/renderer/components/FDCodeSourceTextSpec/Props.h>
#include <react/renderer/components/FDCodeSourceTextSpec/States.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>

namespace facebook::react {
extern const char FDCodeSourceTextRunComponentName[];

using FDCodeSourceTextRunShadowNode =
    ConcreteViewShadowNode<FDCodeSourceTextRunComponentName, FDCodeSourceTextRunProps,
                           FDCodeSourceTextRunEventEmitter, FDCodeSourceTextRunState>;
} // namespace facebook::react
