#pragma once

#include "FDCodeSourceTextShadowNode.h"

#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

namespace facebook::react {
using FDCodeSourceTextComponentDescriptor =
    ConcreteComponentDescriptor<FDCodeSourceTextShadowNode>;

void FDCodeSourceTextSpec_registerComponentDescriptorsFromCodegen(
    std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
} // namespace facebook::react
