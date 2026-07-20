# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for lpac
LUCI_DESCRIPTION:=Manage eUICC information and eSIM profiles with lpac
LUCI_DEPENDS:=+luci-base +lpac +ucode-mod-uloop
LUCI_EXTRA_DEPENDS:=lpac (>=2.3.0.438-r2)

PKG_MAINTAINER:=As-tsaqib <0xfiqks@gmail.com>
PKG_LICENSE:=Apache-2.0

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
