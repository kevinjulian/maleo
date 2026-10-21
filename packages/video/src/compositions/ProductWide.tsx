import { ProductReel } from "./ProductReel";
import type { Product } from "../schema";

export const ProductWide: React.FC<Product> = (p) => <ProductReel {...p} />;
