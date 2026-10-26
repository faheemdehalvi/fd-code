#pragma once

#include "FDCodeSourceTextRunShadowNode.h"

#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

namespace facebook::react {
using FDCodeSourceTextRunComponentDescriptor =
    ConcreteComponentDescriptor<FDCodeSourceTextRunShadowNode>;

void FDCodeSourceTextRunSpec_registerComponentDescriptorsFromCodegen(
    std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
} // namespace facebook::react
