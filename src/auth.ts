export const validate = async (request, secret: string) => {

    const isValid = secret === process.env.SECRET;

    return { isValid, credentials: [] };
};