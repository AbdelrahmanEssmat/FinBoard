import {
  Landmark, Wallet, TrendingUp, PiggyBank, CreditCard, Banknote, Coins, Building2, Smartphone, Briefcase, Laptop,
  Percent, Gift, CircleEllipsis, ShoppingBasket, Coffee, Car, Home, Zap, HeartPulse, ShoppingBag, Clapperboard,
  Repeat, GraduationCap, Plane, Receipt, Tag, Utensils, Bus, Fuel, Shirt, Baby, Dog, Dumbbell, Music, Gamepad2,
  BookOpen, Stethoscope, Pill, Wrench, Hammer, Sparkles, Globe, Phone, Wifi, Droplets, Flame, Bike, Train, Ship,
  Gem, Star, Heart, HandCoins, Users, User, School, Church, Store, Package, Truck, Cigarette, Beer, Pizza,
  type LucideIcon,
} from 'lucide-react'

export const ICONS: Record<string, LucideIcon> = {
  landmark: Landmark, wallet: Wallet, 'trending-up': TrendingUp, 'piggy-bank': PiggyBank, 'credit-card': CreditCard,
  banknote: Banknote, coins: Coins, building: Building2, smartphone: Smartphone, briefcase: Briefcase, laptop: Laptop,
  percent: Percent, gift: Gift, 'circle-ellipsis': CircleEllipsis, 'shopping-basket': ShoppingBasket, coffee: Coffee,
  car: Car, home: Home, zap: Zap, 'heart-pulse': HeartPulse, 'shopping-bag': ShoppingBag, clapperboard: Clapperboard,
  repeat: Repeat, 'graduation-cap': GraduationCap, plane: Plane, receipt: Receipt, tag: Tag, utensils: Utensils, bus: Bus,
  fuel: Fuel, shirt: Shirt, baby: Baby, dog: Dog, dumbbell: Dumbbell, music: Music, gamepad: Gamepad2, book: BookOpen,
  stethoscope: Stethoscope, pill: Pill, wrench: Wrench, hammer: Hammer, sparkles: Sparkles, globe: Globe, phone: Phone,
  wifi: Wifi, droplets: Droplets, flame: Flame, bike: Bike, train: Train, ship: Ship, gem: Gem, star: Star, heart: Heart,
  'hand-coins': HandCoins, users: Users, user: User, school: School, church: Church, store: Store, package: Package,
  truck: Truck, cigarette: Cigarette, beer: Beer, pizza: Pizza,
}

export const ICON_NAMES = Object.keys(ICONS)

export function iconFor(name: string | null | undefined): LucideIcon {
  return (name && ICONS[name]) || Tag
}

export const COLORS = [
  '#2563eb', '#0ea5e9', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444', '#ec4899',
  '#a855f7', '#8b5cf6', '#6366f1', '#64748b', '#78716c', '#0f172a',
]
